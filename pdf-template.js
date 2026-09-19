const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname,'builder.css'),'utf8');
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function lines(text){return (text||'').split(/\n/).map(x=>x.trim()).filter(Boolean).map(x=>`<div>${esc(x)}</div>`).join('');}
function entries(arr=[], kind='experience'){
  return arr.map(x=>`<div class="entry"><div class="entry-title">${esc(x.start||'')}${x.end?` – ${esc(x.end)}`:''}</div><div class="entry-title">${esc(x.title|| (kind==='education'?'Degree':kind==='projects'?'Project':'Position'))}</div><div class="entry-meta">${esc(x.company|| (kind==='education'?'Institution':'Company'))}</div><div class="entry-desc">${esc(x.desc||'')}</div></div>`).join('');
}
function resumeHTML(resume={}){
 const d=resume.data||{}; const experience=resume.experience||[]; const education=resume.education||[]; const projects=resume.projects||[]; const template=resume.template||'essential';
 const contact=[d.email,d.phone,d.location,d.website].filter(Boolean).map(x=>`<div>${esc(x)}</div>`).join('');
 const skills=(d.skills||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>`<span class="skill">${esc(x)}</span>`).join('');
 const photo=d.photo?`<img src="${esc(d.photo)}" alt="Profile photo" style="display:block">`:`<div class="photo-placeholder" style="display:flex">YOUR<br>PHOTO</div>`;
 return `<!doctype html><html><head><meta charset="utf-8"><title>FREESUME — ${esc(d.name||'Resume')}</title><style>${css} body{margin:0;background:#fff!important}.resume-paper{box-shadow:none;transform:none!important;width:210mm;min-height:297mm;margin:0;overflow:hidden}.preview-panel{padding:0!important;border:0!important;background:#fff!important}.freesume-watermark{position:absolute;right:18px;bottom:12px}</style></head><body><article class="resume-paper ${template==='executive'?'theme-executive':''} ${template==='creative'?'theme-creative':''} ${template==='editorial'?'theme-editorial':''}">
 <aside class="resume-side"><div class="photo-frame">${photo}</div><div class="side-contact">${contact||'<div>you@email.com</div><div>+91 00000 00000</div><div>India</div>'}</div>
 <section class="side-section"><h3>SKILLS</h3><div class="skill-list">${skills||'<span class="placeholder">Add skills</span>'}</div></section>
 <section class="side-section"><h3>LANGUAGES</h3><div class="side-lines">${lines(d.languages)}</div></section>
 <section class="side-quote"><div class="quote-mark">“</div><p>${esc(d.quote||'Progress happens when you stop waiting and start building.')}</p><small>— ${esc((d.name||'YOUR NAME').split(/\s+/)[0].toUpperCase())}</small></section></aside>
 <div class="resume-main"><header class="resume-header"><div><h1>${esc(d.name||'John Doe')}</h1><h2>${esc(d.title||'PROFESSIONAL TITLE')}</h2></div><div class="resume-tagline">TURNING IDEAS<br>INTO DIGITAL<br>SOLUTIONS</div></header>
 <section class="resume-section"><div class="section-title"><span>◉</span><h3>PROFESSIONAL SUMMARY</h3></div><p>${esc(d.summary||'Your professional summary will appear here.')}</p></section>
 <section class="resume-section"><div class="section-title"><span>▣</span><h3>WORK EXPERIENCE</h3></div>${experience.length?entries(experience):'<p class="placeholder">Your experience will appear here.</p>'}</section>
 <section class="resume-section"><div class="section-title"><span>◆</span><h3>EDUCATION</h3></div>${education.length?entries(education,'education'):'<p class="placeholder">Your education will appear here.</p>'}</section>
 <section class="resume-section"><div class="section-title"><span>⌘</span><h3>PROJECTS</h3></div>${projects.length?entries(projects,'projects'):''}</section>
 <section class="resume-section"><div class="section-title"><span>✦</span><h3>CERTIFICATIONS</h3></div><div class="cert-list">${lines(d.certifications)}</div></section>
 <div class="freesume-watermark">Created by <strong>FREESUME.</strong></div></div></article></body></html>`;
}
module.exports={resumeHTML};
