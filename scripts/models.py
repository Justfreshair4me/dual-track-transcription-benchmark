"""Pin public model snapshots; verify every downloaded byte against committed SHA-256."""
import hashlib, json, pathlib, sys, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS = [('whisper', 'onnx-community/whisper-tiny.en', ['encoder_model_quantized.onnx','decoder_model_merged_quantized.onnx']), ('moonshine','onnx-community/moonshine-tiny-ONNX', ['encoder_model_quantized.onnx','decoder_model_merged_quantized.onnx'])]
def fetch(url):
    with urllib.request.urlopen(url, timeout=180) as r: return r.read()
def digest(data): return hashlib.sha256(data).hexdigest()
def lock():
    items=[]
    for key,repo,onnx in MODELS:
        info=json.loads(fetch('https://huggingface.co/api/models/'+repo))
        revision=info['sha']
        tree=json.loads(fetch(f'https://huggingface.co/api/models/{repo}/tree/{revision}?recursive=true&limit=1000'))
        paths=[x['path'] for x in tree if x['type']=='file' and (x['path'].endswith('.json') or x['path'].endswith('.txt') or x['path']=='README.md' or x['path'] in ['onnx/'+f for f in onnx])]
        missing=set('onnx/'+f for f in onnx)-set(paths)
        if missing: raise RuntimeError(f'{repo} missing {missing}; available ONNX: {[x["path"] for x in tree if x["path"].endswith(".onnx")]}')
        files=[]
        for path in paths:
            data=fetch(f'https://huggingface.co/{repo}/resolve/{revision}/{path}')
            files.append({'path':path,'bytes':len(data),'sha256':digest(data)})
            dest=ROOT/'public/models'/key/path; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
        items.append({'id':key,'repo':repo,'revision':revision,'dtype':'q8','files':files,'bytes':sum(f['bytes'] for f in files)})
    (ROOT/'models.lock.json').write_text(json.dumps({'models':items},indent=2)+'\n')
def download():
    lock=json.loads((ROOT/'models.lock.json').read_text())
    for model in lock['models']:
        for f in model['files']:
            dest=ROOT/'public/models'/model['id']/f['path']
            if dest.exists() and digest(dest.read_bytes())==f['sha256']: continue
            data=fetch(f'https://huggingface.co/{model["repo"]}/resolve/{model["revision"]}/{f["path"]}')
            if len(data)!=f['bytes'] or digest(data)!=f['sha256']: raise RuntimeError('Model integrity failure: '+f['path'])
            dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
    print('All pinned model files verified.')
if __name__=='__main__': {'lock':lock,'download':download}[sys.argv[1]]()
