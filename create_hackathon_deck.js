const pptxgen = require('pptxgenjs');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'CivicPulse AI';
pptx.subject = 'Hackathon pitch deck';
pptx.title = 'CivicPulse AI — Hackathon Pitch';
pptx.company = 'CivicPulse AI';
pptx.lang = 'en-US';
pptx.theme = {
  headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-US'
};
pptx.defineSlideMaster({
  title: 'BASE', background: { color: '0A1423' },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.07, line: { color: '30DDC1', transparency: 100 }, fill: { color: '30DDC1' } } },
    { text: { text: 'CIVICPULSE  /  HACKATHON PITCH', options: { x: 0.55, y: 0.25, w: 5.2, h: 0.25, fontFace: 'Aptos', fontSize: 9, bold: true, color: 'A1B5C5', margin: 0, breakLine: false } } },
    { text: { text: 'CIVICPULSE AI', options: { x: 10.4, y: 7.12, w: 2.4, h: 0.18, fontFace: 'Aptos', fontSize: 8, bold: true, color: 'A1B5C5', align: 'right', margin: 0 } } },
  ],
  slideNumber: { x: 9.95, y: 7.12, color: 'A1B5C5', fontFace: 'Aptos', fontSize: 8, format: '00' },
  margin: 0.1,
});
const C = { navy:'0A1423', panel:'132235', panel2:'182B40', white:'F1F7FA', muted:'A1B5C5', teal:'30DDC1', blue:'56A3FF', orange:'FFAE57', red:'FF6E75', green:'6BE1A0' };
function shape(slide,x,y,w,h,fill, radius=true, lineColor=fill) {
  slide.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x,y,w,h, rectRadius:0.1, line:{color:lineColor,transparency:100}, fill:{color:fill} });
}
function txt(slide,text,x,y,w,h,opts={}) {
  slide.addText(text,{x,y,w,h,fontFace:opts.font||'Aptos',fontSize:opts.size||16,color:opts.color||C.white,bold:!!opts.bold,margin:opts.margin===undefined?0:opts.margin,breakLine:false,fit:'shrink',valign:opts.valign||'mid',align:opts.align||'left',...opts.extra});
}
function header(title,kicker) {
  const s=pptx.addSlide('BASE');
  txt(s,kicker.toUpperCase(),.58,.72,4.2,.22,{size:9,color:C.teal,bold:true});
  txt(s,title,.58,1.05,12.0,.62,{size:27,bold:true});
  return s;
}
function card(s,x,y,w,h,title,body,accent=C.teal,bodySize=14) {
  shape(s,x,y,w,h,C.panel); shape(s,x,y,.055,h,accent,false);
  txt(s,title,x+.23,y+.17,w-.45,.33,{size:16,bold:true});
  txt(s,body,x+.23,y+.62,w-.45,h-.75,{size:bodySize,color:C.muted,valign:'top'});
}
function pill(s,label,x,y,w,color=C.teal) {
  shape(s,x,y,w,.33,C.panel2);
  txt(s,label.toUpperCase(),x+.1,y+.04,w-.2,.22,{size:8,color,bold:true});
}
function notes(s, text) { if (typeof s.addNotes === 'function') s.addNotes(text); }

// 1 — Cover
{
 const s=pptx.addSlide(); s.background={color:C.navy};
 shape(s,0,0,13.333,.07,C.teal,false);
 txt(s,'CIVICTECH  •  AI-ASSISTED TRIAGE',.8,.72,5.5,.28,{size:11,color:C.teal,bold:true});
 txt(s,'CivicPulse\nAI',.78,1.45,7.0,1.9,{size:48,bold:true,valign:'top'});
 txt(s,'From a street-level photo to a\nprioritized civic issue ticket.',.84,3.7,7.2,.88,{size:23,color:C.muted,valign:'top'});
 shape(s,.84,5.28,5.5,.62,C.panel2);
 txt(s,'REPORT   →   ANALYZE   →   CONSOLIDATE   →   TRIAGE',1.04,5.45,5.1,.24,{size:10,color:C.teal,bold:true});
 txt(s,'Hackathon prototype  |  Resident reporting + staff command center',.84,6.58,8.5,.3,{size:12,color:C.muted});
 // pulse motif
 [ [9.5,1.1,2.65,C.teal], [10.0,1.6,1.65,C.blue], [10.48,2.08,.7,C.orange] ].forEach(([x,y,d,c])=>{
   s.addShape(pptx.ShapeType.ellipse,{x,y,w:d,h:d,line:{color:c,transparency:100},fill:{color:c,transparency:8}});
 });
 notes(s,'Opening: CivicPulse AI is a hackathon prototype for turning resident-submitted photos and locations into AI-assisted civic issue tickets. It is designed to help city teams consolidate and triage reports.');
}
// 2 — Problem
{
 const s=header('A simple report can become a hard-to-triage queue','The challenge');
 txt(s,'Residents see the problem first. City teams need a usable signal: what happened, where, and what needs attention.',.62,1.83,11.8,.62,{size:17,color:C.muted,valign:'top'});
 card(s,.65,2.8,3.75,2.15,'Fragmented reports','Photos, locations, and descriptions can arrive through disconnected channels.',C.blue,14);
 card(s,4.78,2.8,3.75,2.15,'Unclear urgency','Without structured context, teams may struggle to compare and prioritize requests.',C.orange,14);
 card(s,8.9,2.8,3.75,2.15,'Duplicate noise','Several neighbors may report the same issue, creating repeat work in the queue.',C.red,14);
 shape(s,.65,5.45,12,.82,C.panel2);
 txt(s,'DESIGN GOAL',.92,5.72,1.45,.2,{size:10,color:C.teal,bold:true});
 txt(s,'Make issue reports structured, easier to consolidate, and visible in one workflow.',2.42,5.64,9.7,.35,{size:17,bold:true});
 notes(s,'Frame this as the problem CivicPulse is designed to address, not as a quantified claim about every city. Fragmented intake, unclear prioritization, and duplicate reports are the workflow pain points.');
}
// 3 — Solution
{
 const s=header('One workflow connects residents to city operations','The solution');
 txt(s,'CivicPulse turns an image and a location into an AI-assisted ticket that staff can review and track.',.62,1.83,11.8,.5,{size:17,color:C.muted});
 const steps=[['01','REPORT','Resident adds a photo and location.',C.blue],['02','ANALYZE','Vision service estimates label, confidence, and priority.',C.teal],['03','CONSOLIDATE','Nearby, same-label reports can join an open ticket.',C.orange],['04','TRACK','Staff review tickets across a status board.',C.green]];
 steps.forEach((v,i)=>{const [n,t,b,c]=v,x=.65+i*3.12;shape(s,x,2.72,2.75,2.65,C.panel);txt(s,n,x+.22,2.95,.7,.5,{size:24,color:c,bold:true});txt(s,t,x+.22,3.67,2.3,.3,{size:13,bold:true});txt(s,b,x+.22,4.15,2.3,.85,{size:13,color:C.muted,valign:'top'});if(i<3)txt(s,'→',x+2.78,3.72,.3,.35,{size:22,color:C.teal,bold:true,align:'center'});});
 shape(s,.65,5.76,12,.55,C.panel2);txt(s,'AI-assisted signal — not an autonomous decision. Human review remains central.',.9,5.91,11.5,.22,{size:12,color:C.teal,bold:true,align:'center'});
 notes(s,'Walk through the intended product loop. The app accepts an image and coordinates, requests analysis, attempts proximity-based duplicate consolidation, and presents tickets in a staff-facing board. AI output is a decision-support signal, not a replacement for human judgment.');
}
// 4 — Demo
{
 const s=header('A quick path from resident report to staff review','Product walkthrough');
 shape(s,.65,1.9,5,4.5,C.panel);pill(s,'Resident report',.92,2.17,1.75,C.blue);txt(s,'Report a street issue',.92,2.7,4,.37,{size:19,bold:true});
 shape(s,.92,3.25,4.45,1.35,C.panel2);txt(s,'PHOTO  ·  issue.jpg',1.15,3.52,3.9,.25,{size:12,color:C.teal,bold:true});txt(s,'Image preview + upload',1.15,3.91,3.9,.25,{size:11,color:C.muted});
 txt(s,'LOCATION',.94,4.88,1.2,.2,{size:9,color:C.muted,bold:true});shape(s,.92,5.2,4.45,.48,'1F354B');txt(s,'Latitude / longitude  ·  browser location',1.08,5.34,4.1,.17,{size:9});
 shape(s,6,1.9,6.65,4.5,C.panel);pill(s,'Command center',6.28,2.17,1.8,C.teal);txt(s,'Issue queue',6.28,2.7,4,.37,{size:19,bold:true});
 [['PENDING',C.red,'Pothole','Priority 87'],['ASSIGNED',C.orange,'Garbage','Priority 56'],['IN PROGRESS',C.blue,'Streetlight','Priority 31']].forEach((a,i)=>{const x=6.28+i*2.02;shape(s,x,3.25,1.8,2.3,C.panel2);txt(s,a[0],x+.12,3.43,1.56,.18,{size:8,color:a[1],bold:true});shape(s,x+.12,3.9,1.56,1.17,C.panel);txt(s,a[2],x+.23,4.12,1.35,.2,{size:11,bold:true});txt(s,a[3],x+.23,4.52,1.35,.18,{size:9,color:C.muted});});
 txt(s,'Prototype caveat: map and live-update elements are not yet wired to actual ticket data.',6.28,5.75,5.9,.35,{size:10,color:C.muted,valign:'top'});
 notes(s,'Demo sequence: open the report screen, select an image and location, submit, then open the command center. Explain that board cards illustrate a workflow; the map and live update behavior are not production-complete. Do not frame sample/fallback tickets as live city reports.');
}
// 5 — Architecture
{
 const s=header('A three-service pipeline powers the prototype','Under the hood');
 const boxes=[['1','REACT + VITE','Resident form\nCommand center\nChat interface',C.blue],['2','EXPRESS API','Ticket routes\nMultipart upload\nMongoDB + Socket.IO',C.teal],['3','FASTAPI VISION','YOLO inference\nHeuristic priority\nImage metadata',C.orange]];
 boxes.forEach((v,i)=>{const [n,t,b,c]=v,x=.75+i*4.12;shape(s,x,2.35,3.45,2.55,C.panel);txt(s,n,x+.24,2.62,.5,.5,{size:22,color:c,bold:true});txt(s,t,x+.82,2.7,2.4,.25,{size:12,bold:true});txt(s,b,x+.82,3.22,2.2,1.2,{size:14,color:C.muted,valign:'top'});if(i<2)txt(s,'→',x+3.56,3.32,.42,.4,{size:23,color:C.teal,bold:true,align:'center'});});
 shape(s,.75,5.35,11.7,.87,C.panel2);txt(s,'FLOW',1,5.64,.6,.2,{size:9,color:C.teal,bold:true});txt(s,'Photo + coordinates → vision analysis → proximity check → MongoDB ticket → dashboard fetch',1.78,5.57,10.25,.34,{size:14,bold:true});
 txt(s,'Stack: React · Node.js / Express · Python FastAPI · YOLO · MongoDB',.8,6.55,10,.23,{size:11,color:C.muted});
 notes(s,'Technical flow: React/Vite submits multipart data to Express. Express forwards the image to FastAPI. The backend attempts to merge matching unresolved reports within 15 meters, otherwise saving a ticket in MongoDB. Socket.IO events are emitted server-side, but the frontend does not currently subscribe.');
}
// 6 — Value
{
 const s=header('Designed to reduce friction in civic issue triage','What makes it useful');
 card(s,.68,2.0,5.8,1.48,'Structured reports','An image plus coordinates creates a more actionable starting point than an unstructured message.',C.blue,13);
 card(s,6.8,2.0,5.8,1.48,'AI-assisted prioritization','A heuristic score and severity estimate can help staff review the queue; staff remain decision-makers.',C.teal,13);
 card(s,.68,3.83,5.8,1.48,'Nearby report consolidation','Same-label reports within 15 m are designed to merge into an open ticket.',C.orange,13);
 card(s,6.8,3.83,5.8,1.48,'Shared ticket workflow','A status board gives the prototype a common place to review incoming issues.',C.green,13);
 shape(s,.68,5.75,11.92,.58,C.panel2);txt(s,'No impact or model-accuracy numbers are claimed; those require a real-world pilot and evaluation.',.95,5.92,11.35,.22,{size:11,color:C.muted,bold:true,align:'center'});
 notes(s,'Emphasize potential value without inventing measured outcomes. The report consolidation threshold in the prototype is 15 meters for same-label, unresolved tickets. AI scoring is heuristic and requires evaluation.');
}
// 7 — Evaluation
{
 const s=header('Measure whether the workflow helps — before scaling','Impact & validation');
 txt(s,'The next proof point is not a bigger claim. It is a small, measurable pilot with human review.',.68,1.82,11.8,.45,{size:17,color:C.muted});
 [['MODEL QUALITY','Precision / recall by issue type',C.blue],['DUPLICATE HANDLING','Correct merges vs. false merges',C.teal],['OPERATIONS','Time from report to triage',C.orange],['TRUST & ACCESS','Completion, privacy, accessibility',C.green]].forEach((a,i)=>{const x=.72+i*3.12;shape(s,x,2.72,2.75,1.65,C.panel);shape(s,x,2.72,2.75,.07,a[2],false);txt(s,a[0],x+.2,3.02,2.35,.24,{size:9,color:a[2],bold:true});txt(s,a[1],x+.2,3.46,2.35,.62,{size:13,bold:true,valign:'top'});});
 txt(s,'Pilot guardrails',.75,4.85,2.2,.3,{size:16,bold:true});
 ['Human review for AI suggestions','Consent and secure handling of location/photos','Clear uncertainty and an auditable status history'].forEach((v,i)=>{shape(s,.76,5.35+i*.34,.12,.12,C.teal);txt(s,v,1.02,5.29+i*.34,10.7,.22,{size:11,color:C.muted});});
 notes(s,'Proposed evaluation, not existing results: evaluate classification precision/recall on labeled images, measure false merges, measure time to triage, and assess accessibility and trust. Use privacy controls and human review in any pilot.');
}
// 8 — Roadmap / close
{
 const s=header('A credible next step: make the prototype dependable','Roadmap & close');
 [['NOW','Show the reporting → analysis → ticket concept',C.teal],['NEXT','Civic-specific classification, category mapping, real map + live updates',C.blue],['THEN','Secure photo storage, staff assignment, genuine before/after verification',C.orange],['PILOT','Measure quality, duplicate reduction, triage time, and resident trust',C.green]].forEach((a,i)=>{const y=1.95+i*.83;pill(s,a[0],.78,y,1.05,a[2]);txt(s,a[1],2.15,y+.035,9.7,.32,{size:15,bold:true});});
 shape(s,.75,5.75,11.85,.78,C.panel2);txt(s,'CivicPulse AI',1.05,5.97,2.2,.3,{size:21,color:C.teal,bold:true});txt(s,'Help communities turn local signals into clearer action.',3.42,6.0,7.8,.26,{size:15});
 txt(s,'Prototype today. Evidence-led civic operations tomorrow.',.8,6.72,10,.2,{size:10,color:C.muted});
 notes(s,'Close with the honest status: the current build demonstrates reporting, analysis, ticketing, and a dashboard concept. Civic-specific model validation, secure media handling, real GIS/live updates, staff controls, and genuine repair verification are proposed next steps. Invite judges to support a measured pilot.');
}

pptx.writeFile({ fileName: '/home/anchit/CivicPulse-AI/CivicPulse_AI_Hackathon_Pitch.pptx' });
