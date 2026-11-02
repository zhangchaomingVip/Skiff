/** Tiny WebAudio easter egg: no audio files, no network, silent until enabled. */
export type CompanionVoice = "poke" | "squash" | "happy" | "eat" | "sleep" | "angry";

interface Tone {
	/** Offset from the voice start, in milliseconds. */
	at: number;
	hz: number;
	/** Glide target; tones without it keep a single pitch. */
	to?: number;
	ms: number;
	wave: OscillatorType;
	gain: number;
}

const VOICES: Record<CompanionVoice, readonly Tone[]> = {
	// A soft knock when petted.
	poke: [{ at: 0, hz: 660, to: 880, ms: 110, wave: "sine", gain: .06 }],
	// The squash: a rubbery drop.
	squash: [{ at: 0, hz: 420, to: 140, ms: 220, wave: "triangle", gain: .09 }],
	// Two bright notes for encouragement.
	happy: [{ at: 0, hz: 880, ms: 110, wave: "sine", gain: .06 }, { at: 110, hz: 1320, ms: 180, wave: "sine", gain: .06 }],
	// A chomp: a short triangle bite followed by a lower one.
	eat: [{ at: 0, hz: 320, to: 220, ms: 90, wave: "triangle", gain: .07 }, { at: 120, hz: 280, to: 190, ms: 100, wave: "triangle", gain: .06 }],
	// A sleepy descending sine.
	sleep: [{ at: 0, hz: 220, to: 165, ms: 320, wave: "sine", gain: .05 }],
	// A square-wave complaint.
	angry: [{ at: 0, hz: 180, to: 120, ms: 160, wave: "square", gain: .05 }, { at: 190, hz: 160, to: 110, ms: 180, wave: "square", gain: .05 }],
};

let audio: AudioContext | undefined;

/** One shared context: creating it per sound would leak and re-trigger autoplay policy. */
function context(): AudioContext | undefined {
	if (audio) {
		if (audio.state === "suspended") void audio.resume().catch(() => {});
		return audio;
	}
	try {
		audio = new AudioContext();
		return audio;
	} catch {
		return undefined;
	}
}

/** Fire and forget: audio is decoration and must never break the deck. */
export function playCompanionVoice(voice: CompanionVoice): void {
	const ctx = context();
	if (!ctx) return;
	try {
		const origin = ctx.currentTime + .01;
		for (const tone of VOICES[voice]) {
			const start = origin + tone.at / 1000;
			const end = start + tone.ms / 1000;
			const oscillator = ctx.createOscillator();
			const amp = ctx.createGain();
			oscillator.type = tone.wave;
			oscillator.frequency.setValueAtTime(tone.hz, start);
			if (tone.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
			amp.gain.setValueAtTime(0, start);
			amp.gain.linearRampToValueAtTime(tone.gain, start + .012);
			amp.gain.exponentialRampToValueAtTime(.0001, end);
			oscillator.connect(amp).connect(ctx.destination);
			oscillator.start(start);
			oscillator.stop(end + .02);
		}
	} catch {
		/* A blocked or exhausted context stays silent. */
	}
}
