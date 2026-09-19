const defaults = {
  name:"", title:"", email:"", phone:"", location:"", website:"",
  summary:"", skills:"", languages:"", certifications:"", quote:""
};
let data = JSON.parse(localStorage.getItem("freesumeResume") || "null") || defaults;
let activeTemplate = localStorage.getItem("freesumeTemplate") || "essential";
const templateNames = {essential:"ESSENTIAL · FREE", editorial:"EDITORIAL · ₹10", executive:"EXECUTIVE · ₹10", creative:"CREATIVE · ₹10"};
let experience = JSON.parse(localStorage.getItem("freesumeExperience") || "[]");
let education = JSON.parse(localStorage.getItem("freesumeEducation") || "[]");
let projects = JSON.parse(localStorage.getItem("freesumeProjects") || "[]");

const form = document.getElementById("resumeForm");
const status = document.getElementById("saveStatus");
const toast = document.getElementById("toast");

function escapeHtml(v=""){return v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
let toastTimer=null;
function showToast(msg,type=""){clearTimeout(toastTimer);toast.textContent=msg;toast.className="toast show"+(type?" "+type:"");toastTimer=setTimeout(()=>toast.classList.remove("show"),3200)}
let currentUser=null;
let saveTimer=null;
async function syncResume(){ if(!currentUser) return; try { await fetch("/api/resume",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data,experience,education,projects,template:activeTemplate})}); } catch {} }
function save(){
  const fd=new FormData(form);
  data={...data,...defaults};
  for(const [k,v] of fd.entries()) if(typeof v==="string") data[k]=v;
  localStorage.setItem("freesumeTemplate",activeTemplate);
  localStorage.setItem("freesumeResume",JSON.stringify(data));
  localStorage.setItem("freesumeExperience",JSON.stringify(experience));
  localStorage.setItem("freesumeEducation",JSON.stringify(education));
  localStorage.setItem("freesumeProjects",JSON.stringify(projects));
  status.textContent=currentUser?"Saved to account":"Saved locally";
  clearTimeout(saveTimer); saveTimer=setTimeout(syncResume,700);
}
function bindTopFields(){
  Object.keys(defaults).forEach(k=>{
    const el=form.elements[k]; if(el){el.value=data[k]||"";el.addEventListener("input",()=>{save();render();});}
  });
}
function card(list,type){
  const configs={
    experience:{title:"Job title",company:"Company",start:"Start",end:"End",desc:"What did you do?"},
    education:{title:"Degree / course",company:"School / university",start:"Start",end:"End",desc:"Details"},
    projects:{title:"Project name",company:"Link (optional)",start:"",end:"",desc:"What did you build or achieve?"}
  }[type];
  return list.map((x,i)=>`<div class="repeat-card">
    <button type="button" class="remove" onclick="removeItem('${type}',${i})">Remove</button>
    <div class="grid two">
      <label>${configs.title}<input data-type="${type}" data-index="${i}" data-key="title" value="${escapeHtml(x.title||"")}"></label>
      <label>${configs.company}<input data-type="${type}" data-index="${i}" data-key="company" value="${escapeHtml(x.company||"")}"></label>
      ${configs.start?`<label>${configs.start}<input data-type="${type}" data-index="${i}" data-key="start" value="${escapeHtml(x.start||"")}"></label>
      <label>${configs.end}<input data-type="${type}" data-index="${i}" data-key="end" value="${escapeHtml(x.end||"")}</label>`:""}
    </div>
    <label>${configs.desc}<textarea data-type="${type}" data-index="${i}" data-key="desc" rows="4">${escapeHtml(x.desc||"")}</textarea></label>
  </div>`).join("");
}
function renderLists(){
  document.getElementById("experienceList").innerHTML=card(experience,"experience");
  document.getElementById("educationList").innerHTML=card(education,"education");
  document.getElementById("projectList").innerHTML=card(projects,"projects");
  document.querySelectorAll("[data-type]").forEach(el=>el.addEventListener("input",e=>{
    const a=e.target.dataset, arr=a.type==="experience"?experience:a.type==="education"?education:projects;
    arr[+a.index][a.key]=e.target.value;save();render();
  }));
}
window.removeItem=(type,i)=>{
  const arr=type==="experience"?experience:type==="education"?education:projects;
  arr.splice(i,1);renderLists();save();render();
};
function add(type){
  const arr=type==="experience"?experience:type==="education"?education:projects;
  arr.push({title:"",company:"",start:"",end:"",desc:""});renderLists();save();
}
document.getElementById("addExperience").onclick=()=>add("experience");
document.getElementById("addEducation").onclick=()=>add("education");
document.getElementById("addProject").onclick=()=>add("projects");

function lines(text){return (text||"").split(/\n/).map(x=>x.trim()).filter(Boolean).map(x=>`<div>${escapeHtml(x)}</div>`).join("")}
function render(){
  document.getElementById("pName").textContent=data.name||"John Doe";
  document.getElementById("pTitle").textContent=data.title||"PROFESSIONAL TITLE";
  const contactParts=[data.email,data.phone,data.location,data.website].filter(Boolean);
  document.getElementById("pContact").innerHTML=contactParts.map((x,i)=>`<div>${escapeHtml(x)}</div>`).join("") || "<div>you@email.com</div><div>+91 00000 00000</div><div>India</div><div>linkedin.com/in/yourname</div>";
  document.getElementById("pSummary").textContent=data.summary||"Your professional summary will appear here.";
  document.getElementById("pExperience").innerHTML=experience.length?experience.map(x=>`<div class="entry"><div class="entry-title">${escapeHtml(x.start||"")}${x.end?` – ${escapeHtml(x.end)}`:""}</div><div class="entry-title">${escapeHtml(x.title||"Position")}</div><div class="entry-meta">${escapeHtml(x.company||"Company")}</div><div class="entry-desc">${escapeHtml(x.desc||"")}</div></div>`).join(""):`<p class="placeholder">Your experience will appear here.</p>`;
  document.getElementById("pEducation").innerHTML=education.length?education.map(x=>`<div class="entry"><div class="entry-title">${escapeHtml(x.start||"")}${x.end?` – ${escapeHtml(x.end)}`:""}</div><div class="entry-title">${escapeHtml(x.title||"Degree")}</div><div class="entry-meta">${escapeHtml(x.company||"Institution")}</div><div class="entry-desc">${escapeHtml(x.desc||"")}</div></div>`).join(""):`<p class="placeholder">Your education will appear here.</p>`;
  document.getElementById("pProjects").innerHTML=projects.map(x=>`<div class="entry"><div class="entry-title">${escapeHtml(x.start||"")}</div><div class="entry-title">${escapeHtml(x.title||"Project")}</div><div class="entry-meta">${escapeHtml(x.company||"")}</div><div class="entry-desc">${escapeHtml(x.desc||"")}</div></div>`).join("");
  document.getElementById("pSkills").innerHTML=(data.skills||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>`<span class="skill">${escapeHtml(x)}</span>`).join("")||'<span class="placeholder">Add skills</span>';
  document.getElementById("pLanguages").innerHTML=lines(data.languages);
  document.getElementById("pCertifications").innerHTML=lines(data.certifications);
  document.getElementById("pQuote").textContent=data.quote||"Progress happens when you stop waiting and start building.";
  const quoteName=(data.name||"YOUR NAME").split(/\s+/)[0].toUpperCase();
  document.querySelector(".side-quote small").textContent="— "+quoteName;
  save();
}
function renderPhoto(){
  const img=document.getElementById("pPhoto"), placeholder=document.getElementById("photoPlaceholder");
  if(data.photo){
    img.src=data.photo; img.style.display="block"; placeholder.style.display="none";
  }else{img.style.display="none";placeholder.style.display="flex";}
}
document.querySelectorAll(".section-btn").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".section-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".form-section").forEach(s=>s.classList.remove("active"));
  btn.classList.add("active");document.getElementById(btn.dataset.section).classList.add("active");
});
document.getElementById("clearBtn").onclick=()=>{
  if(confirm("Clear this resume and start again?")){
    localStorage.removeItem("freesumeResume");localStorage.removeItem("freesumeExperience");localStorage.removeItem("freesumeEducation");localStorage.removeItem("freesumeProjects");
    location.reload();
  }
};
document.getElementById("zoomBtn").onclick=()=>{
  const paper=document.getElementById("resumePaper");
  const current=parseInt(document.getElementById("zoomBtn").textContent);
  const next=current>=120?80:current+20;
  paper.style.transform=`scale(${next/100})`;document.getElementById("zoomBtn").textContent=next+"%";
};
document.getElementById("downloadBtn").onclick=async()=>{
  try{
    if(currentUser) await syncResume();
    const access=await fetch(`/api/download-access?template=${encodeURIComponent(activeTemplate)}`);
    const j=await access.json();
    if(!j.allowed){showToast(j.error||"Sign in or unlock this template first."); if(j.error) accountModal.classList.add("open"); return;}
    showToast("Preparing your PDF…");
    const r=await fetch("/api/download-pdf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({template:activeTemplate,data,experience,education,projects})});
    if(!r.ok){const e=await r.json().catch(()=>({})); throw new Error(e.error||"PDF generation failed.");}
    const blob=await r.blob(); const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`FREESUME-${activeTemplate}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast("PDF downloaded.");
  }catch(e){showToast(e.message||"Could not generate PDF.");}
};
const photoInput=document.getElementById("photoInput");
if(photoInput){
  photoInput.addEventListener("change", e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{data.photo=reader.result;save();renderPhoto();showToast("Profile photo added");};
    reader.readAsDataURL(file);
  });
}
function applyTemplate(){
  const paper=document.getElementById("resumePaper");
  paper.classList.remove("theme-executive","theme-creative","theme-editorial");
  if(activeTemplate==="executive") paper.classList.add("theme-executive");
  if(activeTemplate==="creative") paper.classList.add("theme-creative");
  if(activeTemplate==="editorial") paper.classList.add("theme-editorial");
  document.getElementById("templateChip").textContent=templateNames[activeTemplate];
  document.querySelectorAll(".template-option").forEach(b=>b.classList.toggle("selected",b.dataset.template===activeTemplate));
}
const premiumModal=document.getElementById("premiumModal");
const modalTitle=document.getElementById("modalTitle");
document.querySelectorAll(".template-option").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const t=btn.dataset.template;
    if(t==="essential"){activeTemplate=t;localStorage.setItem("freesumeTemplate",t);applyTemplate();return;}
    if(currentUser){
      fetch(`/api/premium-access?template=${encodeURIComponent(t)}`).then(r=>r.json()).then(j=>{
        if(j.allowed){activeTemplate=t;localStorage.setItem("freesumeTemplate",t);applyTemplate();return;}
        modalTitle.textContent=templateNames[t].split(" · ")[0]; premiumModal.dataset.pendingTemplate=t; premiumModal.classList.add("open"); premiumModal.setAttribute("aria-hidden","false");
      });
    } else {
      modalTitle.textContent=templateNames[t].split(" · ")[0]; premiumModal.dataset.pendingTemplate=t; premiumModal.classList.add("open"); premiumModal.setAttribute("aria-hidden","false");
      showToast("Sign in before buying a premium design.");
    }
    return;
    /* modalTitle.textContent=templateNames[t].split(" · ")[0];
    premiumModal.dataset.pendingTemplate=t;
    premiumModal.classList.add("open");
    premiumModal.setAttribute("aria-hidden","false"); */
  });
});
document.getElementById("modalClose").onclick=()=>{premiumModal.classList.remove("open");premiumModal.setAttribute("aria-hidden","true");};
document.getElementById("modalBuy").onclick=async()=>{
  const pending=premiumModal.dataset.pendingTemplate||"editorial";
  const buy=document.getElementById("modalBuy");
  buy.disabled=true; buy.textContent="Opening payment…";
  try{
    const orderRes=await fetch("/api/create-order",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({template:pending})
    });
    if(!orderRes.ok) throw new Error("Payment server is not configured.");
    const order=await orderRes.json();
    if(!window.Razorpay) throw new Error("Razorpay Checkout could not load.");
    const rzp=new Razorpay({
      key:order.keyId,
      amount:order.amount,
      currency:order.currency,
      name:"FREESUME.",
      description:`Premium ${pending} resume template`,
      order_id:order.orderId,
      handler:async function(response){
        const verifyRes=await fetch("/api/verify-payment",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            template:pending,
            razorpay_order_id:response.razorpay_order_id,
            razorpay_payment_id:response.razorpay_payment_id,
            razorpay_signature:response.razorpay_signature
          })
        });
        const result=await verifyRes.json();
        if(!verifyRes.ok || !result.verified) throw new Error(result.error||"Payment verification failed.");
        activeTemplate=pending;
        localStorage.setItem("freesumeTemplate",activeTemplate);
        localStorage.setItem("freesumeUnlocked_"+pending,"1");
        applyTemplate();
        premiumModal.classList.remove("open");
        showToast("Payment verified — premium template unlocked.");
      },
      prefill:{},
      theme:{color:"#111111"},
      modal:{ondismiss:()=>{buy.disabled=false;buy.textContent="Continue to payment →";}}
    });
    rzp.on("payment.failed",()=>{showToast("Payment was not completed.");buy.disabled=false;buy.textContent="Continue to payment →";});
    rzp.open();
  }catch(err){
    showToast(err.message||"Payment setup is not connected yet.");
    buy.disabled=false; buy.textContent="Continue to payment →";
  }
};
premiumModal.addEventListener("click",e=>{if(e.target===premiumModal) document.getElementById("modalClose").click();});


const accountModal=document.getElementById("accountModal"), accountBtn=document.getElementById("accountBtn"), accountClose=document.getElementById("accountClose"), accountSubmit=document.getElementById("accountSubmit"), logoutBtn=document.getElementById("logoutBtn"), accountPill=document.getElementById("accountPill");
let accountMode="login";
function setAccountMode(mode){accountMode=mode;document.getElementById("loginFields").style.display=mode==="login"?"block":"none";document.getElementById("registerFields").style.display=mode==="register"?"block":"none";document.getElementById("loginTab").classList.toggle("active",mode==="login");document.getElementById("registerTab").classList.toggle("active",mode==="register");document.getElementById("accountTitle").textContent=mode==="login"?"Sign in":"Create your account";accountSubmit.textContent=mode==="login"?"Sign in →":"Create account →";}
function refreshAccountUI(){
  if(currentUser){
    accountPill.textContent=currentUser.name||currentUser.email||"Account";
    accountPill.title=currentUser.email||"";
    accountBtn.textContent="Account";
  }else{
    accountPill.textContent="Guest";
    accountPill.title="Not signed in";
    accountBtn.textContent="Sign in";
  }
  document.getElementById("logoutBtn").style.display=currentUser?"block":"none";
}
async function loadAccount(){const r=await fetch("/api/me");const j=await r.json();currentUser=j.user||null;refreshAccountUI();if(currentUser){const rr=await fetch("/api/resume");if(rr.ok){const x=await rr.json();if(x.resume&&x.resume.data){const d=x.resume.data;data=d.data||data;experience=d.experience||experience;education=d.education||education;projects=d.projects||projects;activeTemplate=d.template||activeTemplate;localStorage.setItem("freesumeResume",JSON.stringify(data));localStorage.setItem("freesumeExperience",JSON.stringify(experience));localStorage.setItem("freesumeEducation",JSON.stringify(education));localStorage.setItem("freesumeProjects",JSON.stringify(projects));localStorage.setItem("freesumeTemplate",activeTemplate);bindTopFields();renderLists();render();renderPhoto();applyTemplate();}}}}
accountBtn.onclick=()=>{setAccountMode("login");accountModal.classList.add("open");accountModal.setAttribute("aria-hidden","false");}; accountClose.onclick=()=>{accountModal.classList.remove("open");accountModal.setAttribute("aria-hidden","true");};
document.getElementById("loginTab").onclick=()=>setAccountMode("login");document.getElementById("registerTab").onclick=()=>setAccountMode("register");
accountSubmit.onclick=async()=>{
  accountSubmit.disabled=true;
  const originalText=accountSubmit.textContent;
  accountSubmit.textContent=accountMode==="login"?"Signing in…":"Creating account…";
  try{
    const body=accountMode==="login"
      ?{email:loginEmail.value.trim(),password:loginPassword.value}
      :{name:registerName.value.trim(),email:registerEmail.value.trim(),password:registerPassword.value};
    const r=await fetch(`/api/auth/${accountMode}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw Error(j.error||"Account request failed");
    currentUser=j.user||null;
    refreshAccountUI();
    accountModal.classList.remove("open");
    accountModal.setAttribute("aria-hidden","true");
    if(currentUser && accountMode==="register"){
      if(!data.name){data.name=currentUser.name;localStorage.setItem("freesumeResume",JSON.stringify(data));bindTopFields();render();}
      showToast(`Account created successfully — welcome, ${currentUser.name}.`,"success");
    }else{
      showToast(currentUser?.name?`Welcome back, ${currentUser.name}.`:"Signed in successfully.","success");
    }
    await syncResume();
  }catch(e){showToast(e.message||"Could not complete account request.","error");}
  finally{accountSubmit.disabled=false;accountSubmit.textContent=originalText;}
};
logoutBtn.onclick=async()=>{await fetch("/api/auth/logout",{method:"POST"});currentUser=null;refreshAccountUI();accountModal.classList.remove("open");showToast("Signed out successfully.","success");};
loadAccount();
bindTopFields();renderLists();render();renderPhoto();applyTemplate();
