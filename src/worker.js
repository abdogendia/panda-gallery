const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/") + "===".slice((s.length+3)%4)), c => c.charCodeAt(0));
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
async function makeToken(secret) {
  const payload = b64url(enc.encode(JSON.stringify({role:"admin",exp:Math.floor(Date.now()/1000)+8*60*60})));
  return `${payload}.${await sign(payload,secret)}`;
}
async function validToken(token, secret) {
  if (!token || !secret) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = await sign(payload,secret);
  if (expected.length !== signature.length) return false;
  let diff=0; for(let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i)^signature.charCodeAt(i);
  if(diff) return false;
  try { const p=JSON.parse(dec.decode(fromB64url(payload))); return p.role === "admin" && p.exp > Math.floor(Date.now()/1000); } catch { return false; }
}
function config(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) throw new Error("GitHub settings are not configured on the Worker.");
  return { owner:env.GITHUB_OWNER, repo:env.GITHUB_REPO, branch:env.GITHUB_BRANCH || "main", path:env.CATALOG_PATH || "panda-bin.json" };
}
function validateCatalog(data) {
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.products)) return "بيانات الكتالوج يجب أن تحتوي على categories و products.";
  if (data.categories.length > 300 || data.products.length > 1000) return "عدد الأقسام أو المنتجات أكبر من الحد المسموح.";
  const ids=new Set();
  for(const c of data.categories){ if(!c || (typeof c.id!=="string"&&typeof c.id!=="number") || !String(c.id).trim() || typeof c.name!=="string" || !c.name.trim()) return "يوجد قسم ببيانات غير صالحة."; }
  for(const p of data.products){
    if(!p || (typeof p.id!=="string"&&typeof p.id!=="number") || !String(p.id).trim() || typeof p.title!=="string" || !p.title.trim()) return "يوجد منتج ببيانات غير صالحة.";
    const id=String(p.id); if(ids.has(id)) return "يوجد أكثر من منتج بنفس المعرف."; ids.add(id);
    if(p.img!=null && (!Array.isArray(p.img) || p.img.length>40 || p.img.some(u=>typeof u!=="string" || !/^https:\/\//i.test(u) || u.length>2048))) return "روابط صور المنتجات غير صالحة. استخدم روابط HTTPS مثل Cloudinary.";
  }
  if(enc.encode(JSON.stringify(data)).length>8_000_000) return "حجم الكتالوج أكبر من 8MB.";
  return null;
}
async function githubRequest(env, path, options={}) {
  const res=await fetch(`https://api.github.com${path}`, { ...options, headers:{
    "Accept":"application/vnd.github+json", "Authorization":`Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version":"2022-11-28", "User-Agent":"Panda-Gallery-Worker",
    ...(options.headers||{})
  }});
  const body=await res.json().catch(()=>({}));
  if(!res.ok){
    const message=res.status===401||res.status===403 ? "تعذر الوصول إلى GitHub. تحقق من صلاحية GitHub Token." : res.status===404 ? "لم يتم العثور على ملف panda-bin.json أو المستودع. تحقق من الإعدادات." : res.status===409||res.status===422 ? "حدث تعارض أثناء تحديث الملف. حاول الحفظ مرة أخرى." : `GitHub API error (${res.status}).`;
    throw new Error(message);
  }
  return body;
}
async function readCatalog(env) {
  const c=config(env); const path=encodeURIComponent(c.path).replace(/%2F/g,"/");
  const result=await githubRequest(env,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
  const binary=atob((result.content||"").replace(/\n/g,""));
  const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  const data=JSON.parse(dec.decode(bytes));
  if(!Array.isArray(data.categories)||!Array.isArray(data.products)) throw new Error("ملف panda-bin.json لا يحتوي على بيانات كتالوج صحيحة.");
  return {...data, _githubSha:result.sha};
}
async function writeCatalog(env, data) {
  const c=config(env); const path=encodeURIComponent(c.path).replace(/%2F/g,"/");
  let current;
  try { current=await githubRequest(env,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`); }
  catch(e) { throw e; }
  const bytes=enc.encode(JSON.stringify({...data,updatedAt:new Date().toISOString()},null,2));
  let binary=""; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const content=btoa(binary);
  await githubRequest(env,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`,{
    method:"PUT", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:"Update Panda Gallery catalog from admin panel",content,sha:current.sha,branch:c.branch})
  });
  return {ok:true,updatedAt:new Date().toISOString(),categories:data.categories.length,products:data.products.length};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":url.origin,"Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization"}});
  if(url.pathname==="/api/health" && request.method==="GET"){
    try { config(env); return json({ok:true,storage:"github",repository:`${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,catalogPath:env.CATALOG_PATH||"panda-bin.json"}); }
    catch(e){return json({ok:false,error:e.message},503);}
  }
  if(url.pathname==="/api/catalog" && request.method==="GET"){
    try { const data=await readCatalog(env); delete data._githubSha; return json(data); }
    catch(e){return json({error:e.message||"تعذر تحميل الكتالوج من GitHub."},503);}
  }
  if(url.pathname==="/api/admin/login" && request.method==="POST"){
    if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET) return json({error:"إعدادات دخول المدير غير مكتملة على الخادم."},503);
    let body; try{body=await request.json();}catch{return json({error:"طلب غير صالح."},400);}
    if(typeof body.password!=="string"||!body.password||body.password.length>256||body.password!==env.ADMIN_PASSWORD) return json({error:"كلمة المرور غير صحيحة."},401);
    return json({token:await makeToken(env.SESSION_SECRET),expiresIn:28800});
  }
  if(url.pathname==="/api/admin/catalog" && request.method==="PUT"){
    const auth=request.headers.get("Authorization")||""; const token=auth.startsWith("Bearer ")?auth.slice(7):"";
    if(!(await validToken(token,env.SESSION_SECRET))) return json({error:"جلسة المدير غير صالحة أو انتهت. سجل الدخول مرة أخرى."},401);
    let data; try{data=await request.json();}catch{return json({error:"بيانات JSON غير صالحة."},400);}
    const error=validateCatalog(data); if(error) return json({error},400);
    try{return json(await writeCatalog(env,data));}catch(e){return json({error:e.message||"تعذر حفظ الكتالوج في GitHub."},502);}
  }
  if(url.pathname.startsWith("/api/")) return json({error:"Not found"},404);
  return env.ASSETS.fetch(request);
 }
};