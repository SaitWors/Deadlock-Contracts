type Cue =
  | "appear"
  | "press"
  | "tear"
  | "deal"
  | "land"
  | "lift"
  | "hum"
  | "reveal"
  | "return"
  | "favorite"

export function createPackAudio() {
  const Audio = window.AudioContext
  if (!Audio) return
  try {
    const context = new Audio()
    const master = context.createGain()
    master.gain.value = 0.24
    master.connect(context.destination)
    const noise = context.createBuffer(1, Math.round(context.sampleRate * 0.35), context.sampleRate)
    const sample = noise.getChannelData(0)
    for (let i = 0; i < sample.length; i++) sample[i] = 2 * Math.random() - 1

    function voice(
      source: AudioScheduledSourceNode,
      time: number,
      duration: number,
      volume: number,
      filter?: BiquadFilterNode,
    ) {
      const envelope = context.createGain()
      envelope.gain.setValueAtTime(0.0001, time)
      envelope.gain.exponentialRampToValueAtTime(volume, time + 0.013)
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration)
      if (filter) {
        source.connect(filter)
        filter.connect(envelope)
      } else source.connect(envelope)
      envelope.connect(master)
      source.start(time)
      source.stop(time + duration)
      source.onended = () => {
        source.disconnect()
        filter?.disconnect()
        envelope.disconnect()
      }
    }

    function tone(
      time: number,
      from: number,
      to: number,
      duration: number,
      volume: number,
      type: OscillatorType = "sine",
    ) {
      const oscillator = context.createOscillator()
      oscillator.type = type
      oscillator.frequency.setValueAtTime(from, time)
      oscillator.frequency.exponentialRampToValueAtTime(to, time + duration)
      voice(oscillator, time, duration, volume)
    }

    function paper(time: number, from: number, to: number, duration: number, volume: number) {
      const source = context.createBufferSource()
      source.buffer = noise
      const filter = context.createBiquadFilter()
      filter.type = "bandpass"
      filter.Q.value = 0.7
      filter.frequency.setValueAtTime(from, time)
      filter.frequency.exponentialRampToValueAtTime(to, time + duration)
      voice(source, time, duration, volume, filter)
    }

    const resume = () => {
      void context.resume().catch(() => {})
    }
    resume()

    return {
      resume,
      play(cue: Cue, delay = 0, rank = 0, hold = 0) {
        if (context.state === "closed") return
        const t = context.currentTime + delay
        const note = 138 * Math.pow(2, rank / 12)
        switch (cue) {
          case "appear":
            tone(t, 160, 107, 0.28, 0.14)
            paper(t, 440, 920, 0.25, 0.13)
            break
          case "press":
            tone(t, 128, 75, 0.11, 0.19)
            break
          case "tear":
            for (let i = 0; i < 4; i++) paper(t + i * 0.028, 1850 + i * 300, 520, 0.12, 0.19)
            tone(t + 0.08, 98, 53, 0.23, 0.18)
            break
          case "deal":
            paper(t, 560, 1600, 0.16, 0.14)
            break
          case "land":
            tone(t, 123, 82, 0.068, 0.12)
            break
          case "lift":
            paper(t, 530, 2200, 0.27, 0.2)
            break
          case "hum":
            if (hold > 0.05) {
              tone(t, note / 2, note * 0.75, hold, 0.08, "triangle")
              if (rank >= 6) tone(t, note * 1.01, note * 1.5, hold, 0.05)
            }
            break
          case "reveal":
            paper(t, 1760, 420, 0.19, 0.16)
            tone(t, note * 2, note * 2.02, 0.24, 0.16)
            if (rank >= 3) tone(t + 0.025, note * 3, note * 3.01, 0.33, 0.11)
            if (rank >= 6) tone(t + 0.07, note * 4, note * 4.02, 0.52, 0.11)
            if (rank === 8) {
              tone(t, 83, 47, 0.65, 0.24, "triangle")
              tone(t + 0.16, note * 5, note * 5.04, 0.72, 0.08)
            }
            break
          case "return":
            paper(t, 1260, 420, 0.25, 0.12)
            break
          case "favorite":
            tone(t, 659, 659, 0.16, 0.15)
            tone(t + 0.07, 880, 880, 0.25, 0.11)
            break
        }
      },
      close() {
        master.disconnect()
        void context.close().catch(() => {})
      },
    }
  } catch {
    // The receipt and animation are available even if Web Audio is blocked.
  }
}
