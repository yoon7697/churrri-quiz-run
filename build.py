from pathlib import Path
import argparse,base64,re,json,os,html
from urllib.parse import urlsplit
root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--require-api-origin', action='store_true')
args=parser.parse_args()
api_origin=os.environ.get('QUIZRUN_API_ORIGIN','').strip().rstrip('/')
if args.require_api_origin and not api_origin:
    parser.error('Set QUIZRUN_API_ORIGIN to the permanent Cloudflare Worker HTTPS origin.')
if api_origin:
    origin=urlsplit(api_origin)
    try:
        valid_port=origin.port is None or origin.port>0
    except ValueError:
        valid_port=False
    if not valid_port or not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::[0-9]+)?',api_origin):
        parser.error('QUIZRUN_API_ORIGIN must be an HTTPS origin without a path, credentials or query.')
def data(name):return base64.b64encode((root/'assets'/name).read_bytes()).decode()
models='\n'.join("const "+var+"=Uint8Array.from(atob('"+data(name)+"'),c=>c.charCodeAt(0));" for var,name in [('padBytes','answer-cushion.glb'),('rabbitBytes','relay-rabbit.glb'),('spongeBarBytes','sponge-bar.glb')])
models+='\nconst crowdImages='+json.dumps(['data:image/png;base64,'+data('crowd-%d-%d.png'%(c,k)) for c in range(4) for k in range(4)])+';'
results_css='<style>'+(root/'results.css').read_text()+'</style>'
page=(root/'index.html').read_text().replace('<link rel="stylesheet" href="results.css">',results_css).replace('<link rel="stylesheet" href="style.css">','<style>'+(root/'style.css').read_text()+'</style>')
def inline(m):
    src=models if m[1]=='models.js' else (root/m[1]).read_text()
    return '<script>'+src.replace('</script','<\\/script')+'</script>'
shared = '\n'.join((root / name).read_text().split("if(typeof module!=='undefined')")[0]
                   .replace("typeof module==='undefined'?MovementConfig:require('./movement-config.js')","MovementConfig")
                   .replace("typeof module==='undefined'?Rules:require('./rules.js')","Rules")
                   for name in ('movement-config.js','rules.js','motion.js','quiz-data.js','character-contact.js','arena-event.js','impact.js'))
(root / 'server' / 'arena-motion.mjs').write_text(shared + '\nexport {Motion,Rules,QuizData,MovementConfig,CharacterContact,ArenaEvent,Impact};\n')
result=re.sub(r'<script src="([^"]+)"></script>',inline,page)
(root/'public').mkdir(exist_ok=True);(root/'public'/'quiz-air-answer.html').write_text(result)

# Standalone portal: keep the arena inert until an iframe is opened.
portal=(root/'portal.html').read_text().replace('<link rel="stylesheet" href="results.css">',results_css)
portal=portal.replace('name="quizrun-api" content=""','name="quizrun-api" content="'+html.escape(api_origin,quote=True)+'"')
portal=portal.replace('<link rel="stylesheet" href="portal.css">','<style>'+(root/'portal.css').read_text()+'</style>')
hero='data:image/webp;base64,'+data('hero.webp')

def inline_portal(m):
    script=(root/m[1]).read_text().replace('</script','<\\/script')
    if m[1]=='portal.js':script=script.replace('assets/hero.webp',hero)
    return '<script>'+script+'</script>'
portal=re.sub(r'<script src="([^"]+)"></script>',inline_portal,portal)
payload=base64.b64encode(result.encode()).decode()
portal=portal.replace('<template id="arena-source">','<template id="arena-source" data-payload="'+payload+'">')
(root/'public'/'index.html').write_text(portal)
