// A conservative quiet-audio gate, not a speaker or semantic speech detector.
// Keep short, soft utterances; reject silence and isolated microphone clicks.
export function hasAudibleSamples(channels: readonly Float32Array[], sampleRate: number): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return true;
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  for (const samples of channels) {
    let audibleSamples = 0;
    for (let offset = 0; offset < samples.length; offset += frameSize) {
      const count = Math.min(frameSize, samples.length - offset);
      let sum = 0;
      let squares = 0;
      for (let index = offset; index < offset + count; index++) {
        const value = samples[index];
        if (!Number.isFinite(value)) return true;
        sum += value;
        squares += value * value;
      }
      const variance = Math.max(0, squares / count - (sum / count) ** 2);
      if (variance >= 0.002 ** 2) audibleSamples += count;
      if (audibleSamples >= sampleRate * 0.08) return true;
    }
  }
  return false;
}

// Each capture chunk is its own complete container. Decode locally before an
// STT request; unavailable decoders fail open rather than discarding speech.
export async function detectAudioActivity(blob: Blob): Promise<boolean | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  try {
    const context = new OfflineAudioContext(1, 1, 16000);
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
    return hasAudibleSamples(channels, audio.sampleRate);
  } catch {
    return null;
  }
}
