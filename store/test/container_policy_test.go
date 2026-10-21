package test

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const containerPolicyChild = "NOTER_TEST_CONTAINER_POLICY_CHILD"

func TestContainerProviderPolicy(t *testing.T) {
	if os.Getenv(containerPolicyChild) == "1" {
		skipIfContainerProviderUnavailable(t)
		t.Fatal("the unavailable Docker provider was unexpectedly accepted")
	}

	executable, err := os.Executable()
	require.NoError(t, err)
	for _, scenario := range []struct {
		name       string
		ci         string
		skip       string
		failure    bool
		wantReason string
	}{
		{"CI true rejects explicit skip", "true", "1", true, "SKIP_CONTAINER_TESTS=1 is not allowed"},
		{"CI one rejects explicit skip", "1", "1", true, "SKIP_CONTAINER_TESTS=1 is not allowed"},
		{"CI true requires Docker", "true", "", true, "CI requires a healthy Docker provider"},
		{"CI one requires Docker", "1", "", true, "CI requires a healthy Docker provider"},
		{"local explicit skip", "false", "1", false, "SKIP_CONTAINER_TESTS=1"},
		{"local unset CI explicit skip", "", "1", false, "SKIP_CONTAINER_TESTS=1"},
		{"local unavailable provider", "false", "", false, "Docker is not running"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, executable, "-test.run=^TestContainerProviderPolicy$", "-test.v", "-test.count=1")
			command.Env = containerPolicyChildEnvironment(os.Environ(), map[string]string{
				containerPolicyChild:   "1",
				"CI":                   scenario.ci,
				"SKIP_CONTAINER_TESTS": scenario.skip,
				// Prevent TestMain from launching another all-driver Go command.
				"DRIVER": "sqlite",
				// Testcontainers can fall back from DOCKER_HOST to a healthy system
				// socket. Missing TLS material makes every client initialization
				// fail deterministically, even on Docker-equipped CI runners.
				"DOCKER_HOST":       "tcp://127.0.0.1:1",
				"DOCKER_TLS_VERIFY": "1",
				"DOCKER_CERT_PATH":  t.TempDir(),
			})
			output, err := command.CombinedOutput()
			require.NoError(t, ctx.Err(), "policy subprocess timed out: %s", output)
			if scenario.failure {
				var exitError *exec.ExitError
				require.ErrorAs(t, err, &exitError, "policy subprocess should fail: %s", output)
				require.Contains(t, string(output), "--- FAIL: TestContainerProviderPolicy")
				require.NotContains(t, string(output), "--- SKIP: TestContainerProviderPolicy")
			} else {
				require.NoError(t, err, "local policy should skip successfully: %s", output)
				require.Contains(t, string(output), "--- SKIP: TestContainerProviderPolicy")
			}
			require.Contains(t, string(output), scenario.wantReason)
			require.NotContains(t, string(output), "unexpectedly accepted")
		})
	}
}

// Windows environment keys are case-insensitive. Remove every inherited spelling
// before appending overrides so a conflicting CI or DRIVER cannot reach the child.
func containerPolicyChildEnvironment(inherited []string, overrides map[string]string) []string {
	environment := make([]string, 0, len(inherited)+len(overrides))
	for _, entry := range inherited {
		key, _, _ := strings.Cut(entry, "=")
		if _, overridden := overrides[strings.ToUpper(key)]; !overridden {
			environment = append(environment, entry)
		}
	}
	for key, value := range overrides {
		environment = append(environment, key+"="+value)
	}
	return environment
}

func TestContainerPolicyChildEnvironmentOverridesCaseInsensitively(t *testing.T) {
	inherited := []string{"driver=postgres", "DRIVER=mysql", "Ci=true", "CI=1", "Path=kept", "=C:=working-directory"}
	original := append([]string(nil), inherited...)
	environment := containerPolicyChildEnvironment(inherited, map[string]string{"DRIVER": "sqlite", "CI": "false"})
	require.ElementsMatch(t, []string{"DRIVER=sqlite", "CI=false", "Path=kept", "=C:=working-directory"}, environment)
	require.Equal(t, original, inherited)
}
