"""Generate fictional, synthetic completed audio for real-model CI (no user recordings)."""
import pathlib,subprocess,wave
root=pathlib.Path('public/fixtures');root.mkdir(parents=True,exist_ok=True)
text=('Today I planted flowers in my garden. Then I read a book about birds. Tomorrow I will take a walk with my friend. This is a fictional test recording. ')*15
subprocess.run(['espeak','-s','140','-w','/tmp/benchmark-speech.wav',text],check=True)
with wave.open('/tmp/benchmark-speech.wav','rb') as f:
    params=f.getparams();data=f.readframes(f.getnframes())
for seconds in [15,30,60]:
    with wave.open(str(root/f'{seconds}.wav'),'wb') as f:
        f.setparams(params);f.writeframes(data[:seconds*params.framerate*params.nchannels*params.sampwidth])
