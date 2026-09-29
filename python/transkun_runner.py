"""Run TransKun without requiring ffmpeg/ffprobe to be installed globally."""

import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np


def _read_wav(path, normalize=True):
    with wave.open(path, "rb") as stream:
        sample_rate = stream.getframerate()
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        frames = stream.readframes(stream.getnframes())

    if sample_width == 1:
        samples = np.frombuffer(frames, dtype=np.uint8).astype(np.int16) - 128
    elif sample_width == 2:
        samples = np.frombuffer(frames, dtype="<i2")
    elif sample_width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        samples = (
            raw[:, 0].astype(np.int32)
            | (raw[:, 1].astype(np.int32) << 8)
            | (raw[:, 2].astype(np.int32) << 16)
        )
        samples[samples & 0x800000 != 0] -= 0x1000000
    elif sample_width == 4:
        samples = np.frombuffer(frames, dtype="<i4")
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sample_width} bytes")

    samples = samples.reshape(-1, channels)
    if normalize:
        samples = np.float32(samples) / 2**15
    return sample_rate, samples


def _as_wav(audio_path):
    if os.path.splitext(audio_path)[1].lower() == ".wav":
        return audio_path, None

    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    temp_dir = tempfile.mkdtemp(prefix="transkun_audio_")
    wav_path = os.path.join(temp_dir, "input.wav")
    command = [
        ffmpeg,
        "-y",
        "-i",
        audio_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        wav_path,
    ]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Unable to decode audio with bundled ffmpeg (exit code {result.returncode}).\n"
            f"{result.stderr[-2000:]}"
        )
    return wav_path, temp_dir


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: transkun_runner.py AUDIO_PATH OUTPUT_MIDI [TransKun options]")

    wav_path, temp_dir = _as_wav(sys.argv[1])
    try:
        sys.argv[1] = wav_path
        import transkun.transcribe as transcribe

        transcribe.readAudio = _read_wav
        transcribe.main()
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
