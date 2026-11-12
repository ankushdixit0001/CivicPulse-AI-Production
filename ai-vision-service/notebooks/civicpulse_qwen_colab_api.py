"""
CivicPulse Qwen3-VL Colab API bridge.
Run only in a Colab GPU runtime. Prototype: Colab and quick tunnels are temporary.
"""
import base64, io, json, os, re, secrets, subprocess, tempfile, threading, time
from pathlib import Path

import requests
import torch
import uvicorn
from PIL import Image
from fastapi import FastAPI, Header, HTTPException
from transformers import AutoProcessor, BitsAndBytesConfig, Qwen3VLForConditionalGeneration
from qwen_vl_utils import process_vision_info

MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct"
if not torch.cuda.is_available():
    raise RuntimeError("No Colab GPU. Select Runtime > Change runtime type > T4 GPU.")
print("GPU:", torch.cuda.get_device_name(0), "| PyTorch:", torch.__version__)

quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True)
processor = AutoProcessor.from_pretrained(MODEL_ID)
model = Qwen3VLForConditionalGeneration.from_pretrained(
    MODEL_ID, quantization_config=quant, device_map="auto", torch_dtype=torch.float16)
model.eval()
print("Loaded:", MODEL_ID)

TOKEN = secrets.token_urlsafe(32)
print("\nCIVICPULSE_QWEN_TOKEN (copy privately to Render; never commit/share):\n", TOKEN)
app = FastAPI(title="CivicPulse Qwen Vision API")
PROMPT = """You are a conservative civic infrastructure photo triage assistant. Analyze only visible evidence. Do not infer address, identity, cause, or hidden facts. Return ONLY JSON with keys: defect_type (pothole|garbage|sewage|streetlight|unknown), confidence (0..1), severity (LOW|MEDIUM|CRITICAL), damage_coverage_pct (0..100), summary, visible_evidence (array), recommended_action, human_review_required (true), bounding_boxes (array of {label,confidence,bbox}). For each clearly visible defect return a tight bbox [x1,y1,x2,y2] on a 0..1000 scale, origin top-left. Require 0<=x1<x2<=1000 and 0<=y1<y2<=1000. Do not box whole image, unrelated objects, shadows, or uncertain regions. Return [] if not confidently localizable. Maximum 10 boxes. Never invent coordinates. Always require human review."""

def analyze(image):
    # qwen-vl-utils accepts PIL images as image content.
    messages = [{"role":"user","content":[
        {"type":"image","image":image,"min_pixels":256*256,"max_pixels":640*640},
        {"type":"text","text":PROMPT}
    ]}]
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(text=[prompt], images=image_inputs, videos=video_inputs,
                       padding=True, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=600, do_sample=False)
    trimmed = [o[len(i):] for i,o in zip(inputs.input_ids,out)]
    raw = processor.batch_decode(trimmed, skip_special_tokens=True,
                                 clean_up_tokenization_spaces=False)[0]
    match = re.search(r"\{.*\}", raw, flags=re.S)
    if not match: raise ValueError("Model did not return a JSON object")
    result = json.loads(match.group(0))
    if result.get("defect_type") not in {"pothole","garbage","sewage","streetlight","unknown"}:
        result["defect_type"] = "unknown"
    clean = []
    for item in (result.get("bounding_boxes") or [])[:10]:
        if not isinstance(item,dict): continue
        try:
            b = [float(v) for v in item["bbox"]]
            if len(b)!=4 or not all(0<=v<=1000 for v in b): continue
            x1,y1,x2,y2=b
            if x2<=x1 or y2<=y1: continue
            clean.append({"label":str(item.get("label","defect"))[:80],
                "confidence":max(0.0,min(1.0,float(item.get("confidence",result.get("confidence",0))))),
                "bbox":b})
        except (KeyError,TypeError,ValueError): continue
    result["bounding_boxes"] = clean
    result["human_review_required"] = True
    return result

def decode_image(messages):
    for msg in messages or []:
        for part in (msg.get("content") if isinstance(msg.get("content"),list) else []):
            if part.get("type") != "image_url": continue
            obj = part.get("image_url",{})
            url = obj.get("url","") if isinstance(obj,dict) else obj
            if not isinstance(url,str) or not url.startswith("data:image/") or "," not in url:
                raise ValueError("Only base64 data:image URLs are accepted")
            _, encoded = url.split(",",1)
            if len(encoded)>12_000_000: raise ValueError("Image exceeds 8 MB limit")
            raw = base64.b64decode(encoded,validate=True)
            image = Image.open(io.BytesIO(raw)).convert("RGB")
            image.thumbnail((1600,1600))
            return image
    raise ValueError("No image_url supplied")

@app.get("/health")
def health():
    return {"status":"ok","model":MODEL_ID,"gpu":torch.cuda.get_device_name(0)}

@app.post("/v1/chat/completions")
def chat_completions(payload:dict, authorization:str=Header(default="")):
    if not secrets.compare_digest(authorization,"Bearer "+TOKEN):
        raise HTTPException(status_code=401,detail="Unauthorized")
    try:
        result = analyze(decode_image(payload.get("messages",[])))
        return {"id":"civicpulse-qwen","object":"chat.completion",
            "choices":[{"index":0,"message":{"role":"assistant","content":json.dumps(result)},
                        "finish_reason":"stop"}]}
    except Exception as exc:
        raise HTTPException(status_code=422,detail=f"Image analysis failed: {str(exc)[:300]}")

def run_api():
    uvicorn.run(app,host="0.0.0.0",port=8000,log_level="warning")

threading.Thread(target=run_api,daemon=True).start()
for _ in range(45):
    try:
        requests.get("http://127.0.0.1:8000/health",timeout=2).raise_for_status()
        break
    except requests.RequestException: time.sleep(1)
else: raise RuntimeError("Local API failed to start on port 8000")
print("Local API healthy.")

# Cloudflare quick tunnel; log output is streamed to a file without blocking readline().
binary="/usr/local/bin/cloudflared"
subprocess.run(["wget","-q","https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64","-O",binary],check=True)
os.chmod(binary,0o755)
log_path="/tmp/civicpulse-cloudflared.log"
log_handle=open(log_path,"w")
tunnel=subprocess.Popen([binary,"tunnel","--url","http://127.0.0.1:8000","--no-autoupdate"],
    stdout=log_handle,stderr=subprocess.STDOUT)
public_url=None
deadline=time.time()+120
while time.time()<deadline and tunnel.poll() is None:
    log_handle.flush()
    try: logs=Path(log_path).read_text(errors="ignore")
    except OSError: logs=""
    found=re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com",logs)
    if found:
        public_url=found.group(0); break
    time.sleep(2)
if not public_url:
    log_handle.flush()
    raise RuntimeError("Tunnel URL unavailable. Check /tmp/civicpulse-cloudflared.log")
print("\nQWEN_VL_BASE_URL =",public_url+"/v1")
print("Health check:",requests.get(public_url+"/health",timeout=30).status_code)
print("Keep this Colab session running. The URL changes after a runtime restart.")
