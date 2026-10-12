"""Fictional audio, with distinct spoken markers near the middle and end of long clips."""
import pathlib, subprocess, wave
root = pathlib.Path('public/fixtures'); root.mkdir(parents=True, exist_ok=True)
def speech(name, text):
    path = '/tmp/benchmark-' + name + '.wav'
    subprocess.run(['espeak', '-s', '140', '-w', path, text], check=True)
    with wave.open(path, 'rb') as f:
        return f.getparams(), f.readframes(f.getnframes())
params, body = speech('body', 'Today I planted flowers in my garden. Then I read a book about birds. Tomorrow I will take a walk with my friend. This is a fictional test recording. ' * 15)
_, middle = speech('middle', 'At the middle, I bought a purple lantern. I put the purple lantern in my tent.')
_, tail = speech('tail', 'At the end, I drew a silver dragon. I put the silver dragon in my notebook.')
for seconds in [15, 30, 60, 180, 300]:
    byte_rate = params.framerate * params.nchannels * params.sampwidth
    target_bytes = (seconds * params.framerate + (441 if seconds == 300 else 0)) * params.nchannels * params.sampwidth
    repeated = body * ((target_bytes + len(body) - 1) // len(body))
    audio = bytearray(repeated[:target_bytes])
    if len(audio) != target_bytes: raise RuntimeError('Synthetic body is too short')
    if seconds >= 180:
        # Markers lie inside interior/final chunks for both chunk sizes, not on boundaries.
        start = (seconds // 2 + 2) * byte_rate
        audio[start:start + len(middle)] = middle
        start = len(audio) - len(tail) - 2 * byte_rate
        audio[start:start + len(tail)] = tail
    with wave.open(str(root / f'{seconds}.wav'), 'wb') as f:
        f.setparams(params); f.writeframes(audio)
