package cache

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCacheBasicOperations(t *testing.T) {
	ctx := context.Background()
	config := DefaultConfig()
	config.DefaultTTL = 100 * time.Millisecond
	config.CleanupInterval = 50 * time.Millisecond
	cache := New(config)
	defer cache.Close()

	// Test Set and Get
	cache.Set(ctx, "key1", "value1")
	if val, ok := cache.Get(ctx, "key1"); !ok || val != "value1" {
		t.Errorf("Expected 'value1', got %v, exists: %v", val, ok)
	}

	// Test SetWithTTL
	cache.SetWithTTL(ctx, "key2", "value2", 200*time.Millisecond)
	if val, ok := cache.Get(ctx, "key2"); !ok || val != "value2" {
		t.Errorf("Expected 'value2', got %v, exists: %v", val, ok)
	}

	// Test Delete
	cache.Delete(ctx, "key1")
	if _, ok := cache.Get(ctx, "key1"); ok {
		t.Error("Key 'key1' should have been deleted")
	}

	// Test automatic expiration
	time.Sleep(150 * time.Millisecond)
	if _, ok := cache.Get(ctx, "key1"); ok {
		t.Error("Key 'key1' should have expired")
	}
	// key2 should still be valid (200ms TTL)
	if _, ok := cache.Get(ctx, "key2"); !ok {
		t.Error("Key 'key2' should still be valid")
	}

	// Wait for key2 to expire
	time.Sleep(100 * time.Millisecond)
	if _, ok := cache.Get(ctx, "key2"); ok {
		t.Error("Key 'key2' should have expired")
	}

	// Test Clear
	cache.Set(ctx, "key3", "value3")
	cache.Clear(ctx)
	if _, ok := cache.Get(ctx, "key3"); ok {
		t.Error("Cache should be empty after Clear()")
	}
}

func TestCacheEviction(t *testing.T) {
	ctx := context.Background()
	config := DefaultConfig()
	config.MaxItems = 5
	cache := New(config)
	defer cache.Close()

	// Capacity eviction chooses the earliest expiration, not insertion order.
	// Separate the TTLs explicitly: rapid Set calls can share a clock reading,
	// and equal expiration timestamps do not define which tied key is evicted.
	for i := range 5 {
		key := fmt.Sprintf("key%d", i)
		cache.SetWithTTL(ctx, key, i, time.Duration(i+1)*time.Hour)
	}

	// Verify all 5 items are in the cache
	for i := range 5 {
		key := fmt.Sprintf("key%d", i)
		if _, ok := cache.Get(ctx, key); !ok {
			t.Errorf("Key '%s' should be in the cache", key)
		}
	}

	// Add 2 more items to trigger eviction
	cache.SetWithTTL(ctx, "keyA", "valueA", 6*time.Hour)
	cache.SetWithTTL(ctx, "keyB", "valueB", 7*time.Hour)

	// Verify size is still within limits
	if cache.Size() > int64(config.MaxItems) {
		t.Errorf("Cache size %d exceeds limit %d", cache.Size(), config.MaxItems)
	}

	// Exactly the two earliest expirations should have been evicted.
	for i := range 5 {
		key := fmt.Sprintf("key%d", i)
		_, exists := cache.Get(ctx, key)
		if expected := i >= 2; exists != expected {
			t.Errorf("Key '%s' existence %v, want %v after earliest-expiration eviction", key, exists, expected)
		}
	}

	// The newer keys should still be present
	if _, ok := cache.Get(ctx, "keyA"); !ok {
		t.Error("Key 'keyA' should be in the cache")
	}
	if _, ok := cache.Get(ctx, "keyB"); !ok {
		t.Error("Key 'keyB' should be in the cache")
	}
}

func TestCacheEvictionWithEqualExpirations(t *testing.T) {
	ctx := context.Background()
	type eviction struct {
		key   string
		value any
	}
	config := DefaultConfig()
	config.MaxItems = 5
	evictions := make(chan eviction, config.MaxItems+1)
	config.OnEviction = func(key string, value any) {
		evictions <- eviction{key: key, value: value}
	}
	cache := New(config)
	defer cache.Close()

	// Force exact equal timestamps without depending on platform clock precision.
	// No particular key wins the tie, but capacity and callbacks still must agree.
	expiration := time.Now().Add(time.Hour)
	for i := range config.MaxItems + 1 {
		cache.data.Store(fmt.Sprintf("key%d", i), item{value: i, expiration: expiration, size: estimateSize(i)})
	}
	cache.itemCount.Store(int64(config.MaxItems + 1))
	cache.cleanupOldest()
	if size := cache.Size(); size != int64(config.MaxItems) {
		t.Fatalf("Cache size %d, want %d after one tied eviction", size, config.MaxItems)
	}

	var removed string
	select {
	case event := <-evictions:
		removed = event.key
		if expected := fmt.Sprintf("key%v", event.value); event.key != expected {
			t.Errorf("Eviction callback key %q does not match value %v", event.key, event.value)
		}
	default:
		t.Fatal("Capacity eviction must notify its callback")
	}
	remaining := 0
	for i := range config.MaxItems + 1 {
		key := fmt.Sprintf("key%d", i)
		value, exists := cache.Get(ctx, key)
		if key == removed {
			if exists {
				t.Errorf("Evicted key %q still exists", key)
			}
		} else if !exists || value != i {
			t.Errorf("Non-evicted key %q lost its value: %v, exists: %v", key, value, exists)
		}
		if exists {
			remaining++
		}
	}
	if remaining != config.MaxItems {
		t.Errorf("Found %d keys, want %d", remaining, config.MaxItems)
	}
	// At capacity, another cleanup must neither remove a key nor notify again.
	cache.cleanupOldest()
	select {
	case event := <-evictions:
		t.Errorf("Unexpected additional eviction at capacity: %+v", event)
	default:
	}
}

func TestCacheConcurrency(t *testing.T) {
	ctx := context.Background()
	cache := NewDefault()
	defer cache.Close()

	const goroutines = 10
	const operationsPerGoroutine = 100

	var wg sync.WaitGroup

	for id := range goroutines {
		wg.Go(func() {
			baseKey := fmt.Sprintf("worker%d-", id)

			// Set operations
			for j := range operationsPerGoroutine {
				key := fmt.Sprintf("%skey%d", baseKey, j)
				value := fmt.Sprintf("value%d-%d", id, j)
				cache.Set(ctx, key, value)
			}

			// Get operations
			for j := range operationsPerGoroutine {
				key := fmt.Sprintf("%skey%d", baseKey, j)
				val, ok := cache.Get(ctx, key)
				if !ok {
					t.Errorf("Key '%s' should exist in cache", key)
					continue
				}
				expected := fmt.Sprintf("value%d-%d", id, j)
				if val != expected {
					t.Errorf("For key '%s', expected '%s', got '%s'", key, expected, val)
				}
			}

			// Delete half the keys
			for j := range operationsPerGoroutine / 2 {
				key := fmt.Sprintf("%skey%d", baseKey, j)
				cache.Delete(ctx, key)
			}
		})
	}

	wg.Wait()

	// Verify size and deletion
	var totalKeysExpected int64 = goroutines * operationsPerGoroutine / 2
	if cache.Size() != totalKeysExpected {
		t.Errorf("Expected cache size to be %d, got %d", totalKeysExpected, cache.Size())
	}
}

func TestEvictionCallback(t *testing.T) {
	ctx := context.Background()
	evicted := make(map[string]any)
	evictedMu := sync.Mutex{}

	config := DefaultConfig()
	config.DefaultTTL = 50 * time.Millisecond
	config.CleanupInterval = 25 * time.Millisecond
	config.OnEviction = func(key string, value any) {
		evictedMu.Lock()
		evicted[key] = value
		evictedMu.Unlock()
	}

	cache := New(config)
	defer cache.Close()

	// Add items
	cache.Set(ctx, "key1", "value1")
	cache.Set(ctx, "key2", "value2")

	// Manually delete
	cache.Delete(ctx, "key1")

	// Verify manual deletion triggered callback
	time.Sleep(10 * time.Millisecond) // Small delay to ensure callback processed
	evictedMu.Lock()
	if evicted["key1"] != "value1" {
		t.Error("Eviction callback not triggered for manual deletion")
	}
	evictedMu.Unlock()

	// Wait for automatic expiration
	time.Sleep(60 * time.Millisecond)

	// Verify TTL expiration triggered callback
	evictedMu.Lock()
	if evicted["key2"] != "value2" {
		t.Error("Eviction callback not triggered for TTL expiration")
	}
	evictedMu.Unlock()
}
