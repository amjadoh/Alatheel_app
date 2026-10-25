import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { MessageSquareText, Plus, ImagePlus, Paperclip, X, FileText, Send, ExternalLink, Copy, ArrowRight, RefreshCw } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { feedbackCommand, getNotificationServices, errorText, type Actor } from "./service";
import { RELEASE_VERSION } from "./release-notes";
import "./feedback.css";
import { displayDate, displayNumber } from "./format";
type Note = { id: string; title?:string; resolution?:string; text: string; files: any[]; version: string; createdAt: string; createdByName: string; syncState: string; status: string; issueUrl?: string; emailState?: string };
const statusNames: Record<string,string> = { new: "جديدة", discussion: "قيد المعالجة", resolved: "تم حلها" };
const syncNames: Record<string,string> = { queued: "محفوظة · بانتظار الرفع التلقائي", uploading: "جارٍ الرفع إلى المستودع", synced: "مرفوعة إلى المستودع", failed: "تعذر الرفع؛ يمكنك إعادة المحاولة" };
const chunkSize = 384 * 1024;
function AttachmentPreview({file}:{file:File}) {
  const [url,setUrl]=useState("");
  useEffect(()=>{if(!file.type.startsWith("image/"))return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
  return url ? <img className="feedback-thumbnail" src={url} alt={file.name} onError={()=>setUrl("")}/> : <FileText size={20}/>;
}
function base64(bytes: Uint8Array) { let text = ""; for (let i=0;i<bytes.length;i++) text += String.fromCharCode(bytes[i]); return btoa(text); }
function fileValidation(files: File[]) {
  if (files.length > 5) throw new Error("الحد خمسة مرفقات لكل بلاغ");
  if (files.some(f => !f.size || f.size > 10*1024*1024)) throw new Error("كل مرفق يجب أن يكون بين بايت و10 ميجابايت");
  if (files.reduce((n,f)=>n+f.size,0) > 20*1024*1024) throw new Error("إجمالي المرفقات يجب ألا يتجاوز 20 ميجابايت");
  if (files.some(f=>! /\.(jpe?g|png|webp|gif|heic|heif|pdf|txt|csv|docx?|xlsx?|pptx?|zip|mp4|mp3|m4a|wav)$/i.test(f.name))) throw new Error("نوع المرفق غير مدعوم؛ اختر صورة أو مستندًا أو ملفًا مضغوطًا أو مقطعًا");
}
export function FeedbackLauncher({ visible, onOpen }: { visible: boolean; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  useEffect(()=>{
    const check=()=>setEditing(!!document.activeElement?.matches("input,textarea,select,[contenteditable=true]"));
    document.addEventListener("focusin",check); document.addEventListener("focusout",check);
    return ()=>{document.removeEventListener("focusin",check);document.removeEventListener("focusout",check);};
  },[]);
  if (!visible) return null;
  return <div className="feedback-launcher-lane">{!editing&&<button className="feedback-launcher" aria-label="بلاغات التطبيق" onClick={onOpen}><MessageSquareText size={27}/><span aria-hidden="true" /></button>}</div>;
}
export function FeedbackPanel({ actor, onBusy, primary=false }: { actor: Actor; onBusy: (value:boolean)=>void; primary?:boolean }) {
  const [title,setTitle]=useState(""),[resolving,setResolving]=useState(""),[resolution,setResolution]=useState(""),[sharing,setSharing]=useState(""),[shareFiles,setShareFiles]=useState<number[]>([]),[preview,setPreview]=useState<Record<string,string>>({});
  const [notes,setNotes]=useState<Note[]>([]),[compose,setCompose]=useState(false),[text,setText]=useState(""),[files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[progress,setProgress]=useState("");
  const imageInput=useRef<HTMLInputElement>(null),fileInput=useRef<HTMLInputElement>(null),lock=useRef(false),request=useRef({id:"",fingerprint:""});
  const services=getNotificationServices();
  useEffect(()=>{
    setNotes([]);
    if(actor.role!=="admin" || !actor.dataReady || !services)return;
    return onSnapshot(query(collection(services.db,"appFeedback"),...(primary?[]:[where("createdBy","==",actor.uid)]),orderBy("createdAt","desc"),limit(100)),snap=>{
      setNotes(snap.docs.map(d=>({id:d.id,...d.data()} as Note)).filter(n=>n.syncState!=="draft"));
    },()=>setError("تعذر تحميل البلاغات؛ تحقق من الاتصال وأعد فتح الصفحة"));
  },[actor.uid,actor.role,actor.dataReady,services?.db,primary]);
  function select(list: FileList | null) {
    try { const next=[...files,...Array.from(list||[])]; fileValidation(next);setFiles(next);setError(""); }
    catch(e){setError(errorText(e));}
  }
  async function work(fn:()=>Promise<void>) {
    if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError("");setNotice("");
    try { await fn(); }catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);onBusy(false);setProgress("");}
  }
  async function submit(e:React.FormEvent) {
    e.preventDefault();
    await work(async()=>{
      fileValidation(files);if(!text.trim()&&!files.length)throw new Error("اكتب بلاغ أو أرفق ملفًا");
      setProgress("تجهيز المرفقات…");
      const buffers=await Promise.all(files.map(f=>f.arrayBuffer()));
      const metadata=await Promise.all(files.map(async(f,i)=>({name:f.name,size:f.size,mime:f.type,sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffers[i]))).map(x=>x.toString(16).padStart(2,"0")).join("")})));
      const manifest={title:title.trim(),text:text.trim(),files:metadata,version:RELEASE_VERSION},fingerprint=JSON.stringify(manifest);
      if(request.current.fingerprint!==fingerprint)request.current={id:crypto.randomUUID(),fingerprint};
      const id=request.current.id;
      const created=await feedbackCommand({action:"create",id,...manifest});
      let sent=0;const total=files.reduce((n,f)=>n+f.size,0);
      if(created.syncState==="draft") for(let i=0;i<files.length;i++)for(let start=0,chunk=0;start<buffers[i].byteLength;start+=chunkSize,chunk++){
        const bytes=new Uint8Array(buffers[i].slice(start,start+chunkSize));
        await feedbackCommand({action:"upload",id,file:i,chunk,base64:base64(bytes)});
        sent+=bytes.length;setProgress(`رفع المرفقات ${displayNumber(Math.round(sent/total*100))}%`);
      }
      setProgress("حفظ البلاغ…");await feedbackCommand({action:"submit",id});
      setCompose(false);setText("");setTitle("");setFiles([]);request.current={id:"",fingerprint:""};
      setNotice("تم حفظ البلاغ؛ ستُرفع تلقائيًا إلى المستودع مع المرفقات خلال دقائق");
    });
  }
  async function download(note:Note,index:number) {
    await work(async()=>{
      const file=await feedbackCommand({action:"download",id:note.id,file:index});
      if(String(file.mime).startsWith("image/")&&!/heic|heif/i.test(file.mime)){setPreview(old=>({...old,[note.id+"_"+index]:"data:"+file.mime+";base64,"+file.base64}));return;}
      if(Capacitor.isNativePlatform()){
        const saved=await Filesystem.writeFile({directory:Directory.Cache,path:"feedback-"+note.id+"-"+index+"-"+file.name.replace(/[^\p{L}\p{N}._-]/gu,"_"),data:file.base64});
        await Share.share({title:file.name,files:[saved.uri]});
      }else{
        const bytes=Uint8Array.from(atob(file.base64),(x:string)=>x.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:file.mime||"application/octet-stream"}));
        const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    });
  }
  async function copy(note:Note,selected:number[]=[]){await work(async()=>{
    const value=`بلاغ تطبيق الأثيل\n${note.title||""}\n${note.text||"مرفقات فقط"}\nالحالة: ${statusNames[note.status]||note.status}\nالإصدار ${note.version}`;
    if(Capacitor.isNativePlatform()){
      const uris:string[]=[];
      for(const index of selected){const file=await feedbackCommand({action:"download",id:note.id,file:index});const saved=await Filesystem.writeFile({directory:Directory.Cache,path:"feedback-share-"+note.id+"-"+index+"-"+file.name.replace(/[^\p{L}\p{N}._-]/gu,"_"),data:file.base64});uris.push(saved.uri);}
      await Share.share({title:note.title||"بلاغ الأثيل",text:value,...(uris.length?{files:uris}:{})});
    }else{if(selected.length)throw new Error("مشاركة المرفقات متاحة من تطبيق أندرويد؛ يمكنك تنزيلها من القائمة");await navigator.clipboard.writeText(value);}
    setNotice("تم تجهيز البلاغ المحدد للمشاركة");setSharing("");
  });}
  return <div className="feedback-panel" dir="rtl">
    {notice&&<p className="notice" role="status">{notice}</p>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    {compose ? <form onSubmit={e=>void submit(e)} aria-label="فتح بلاغ"><fieldset disabled={busy}>
      <button className="text-link" type="button" onClick={()=>setCompose(false)}><ArrowRight size={16}/>العودة إلى البلاغات</button>
      <label className="field"><span>عنوان البلاغ</span><input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="field"><span>تفاصيل البلاغ</span><textarea maxLength={6000} rows={5} value={text} onChange={e=>setText(e.target.value)} placeholder="اكتب ما لاحظته على التطبيق…"/></label>
      <input ref={imageInput} hidden aria-label="اختيار صور البلاغ" type="file" accept="image/*" multiple onChange={e=>{select(e.target.files);e.target.value="";}}/>
      <input ref={fileInput} hidden aria-label="اختيار مرفقات البلاغ" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp4,.mp3,.m4a,.wav" onChange={e=>{select(e.target.files);e.target.value="";}}/>
      <div className="actions"><button className="button outline" type="button" onClick={()=>imageInput.current?.click()}><ImagePlus size={18}/>إضافة صورة</button><button className="button outline" type="button" onClick={()=>fileInput.current?.click()}><Paperclip size={18}/>إضافة ملف</button></div>
      {files.map((f,i)=><div className="feedback-file" key={f.name+f.size+i}><AttachmentPreview file={f}/><span><bdi>{f.name}</bdi><small>{displayNumber(Math.ceil(f.size/1024))} كيلوبايت</small></span><button type="button" aria-label={`حذف المرفق ${f.name}`} onClick={()=>setFiles(files.filter((_,index)=>index!==i))}><X size={18}/></button></div>)}
      <p className="small muted">حتى 5 مرفقات · 10 ميجابايت للملف · 20 ميجابايت إجماليًا. تُرسل البلاغ ومرفقاتها إلى مستودع التطبيق الخاص، وتصل نسخة إلى بريد المدير الأساسي.</p>
      {progress&&<p role="status">{progress}</p>}
      <button className="button gold" type="submit" disabled={busy||(!text.trim()&&!files.length)}><Send size={17}/>{busy?"جارٍ الإرسال…":"إرسال البلاغ"}</button>
    </fieldset></form> : <>
      <button className="button gold" disabled={busy} onClick={()=>{setCompose(true);setError("");setNotice("");}}><Plus size={18}/>فتح بلاغ</button>
      {!notes.length&&<p className="muted">لا توجد ملاحظات مرسلة بعد.</p>}
      {notes.map(note=><section className="feedback-note" key={note.id}>
        <div className="spread"><b>{note.createdByName}</b><span className="pill">{statusNames[note.status]||"جديدة"}</span></div>
        <p className="small muted">{displayDate(note.createdAt)} · الإصدار <bdi>{note.version}</bdi></p>
        <h3>{note.title||"بلاغ التطبيق"}</h3><p className="feedback-note-text">{note.text||"مرفقات فقط"}</p>
        {(note.files||[]).map((file,index)=><button className="feedback-file" key={index} disabled={busy} onClick={()=>void download(note,index)}><Paperclip size={18}/><span><bdi>{file.name}</bdi><small>{displayNumber(Math.ceil(file.size/1024))} كيلوبايت</small></span></button>)}
        {(note.files||[]).map((file,index)=>preview[note.id+"_"+index]&&<img className="feedback-full-image" key={index} src={preview[note.id+"_"+index]} alt={file.name}/>)}
        <p className="small muted" role="status">{syncNames[note.syncState]||"محفوظة"}{note.emailState==="failed"?" · تعذر إرسال نسخة البريد؛ البلاغ محفوظ":""}</p>
        {note.resolution&&<p className="notice">بلاغ الحل: {note.resolution}</p>}
        {primary&&<label className="field"><span>حالة البلاغ</span><select disabled={busy} value={note.status} onChange={e=>{if(e.target.value==="resolved"){setResolving(note.id);setResolution("");}else void work(async()=>{await feedbackCommand({action:"status",id:note.id,status:e.target.value});});}}>{Object.entries(statusNames).map(([key,value])=><option value={key} key={key}>{value}</option>)}</select></label>}
        {resolving===note.id&&<div><label className="field"><span>بلاغ الحل</span><textarea value={resolution} onChange={e=>setResolution(e.target.value)} maxLength={2000}/></label><button className="button gold" disabled={busy||!resolution.trim()} onClick={()=>void work(async()=>{await feedbackCommand({action:"status",id:note.id,status:"resolved",resolution});setResolving("");})}>حفظ الحل</button></div>}
        <div className="actions"><button className="button outline" disabled={busy} onClick={()=>{setSharing(note.id);setShareFiles([]);}}><Copy size={16}/>مشاركة هذا البلاغ</button></div>
        {sharing===note.id&&<section className="notice"><p>مشاركة البلاغ المحدد: {note.title||note.text.slice(0,60)}</p>{(note.files||[]).map((file,index)=><label className="check" key={index}><input type="checkbox" checked={shareFiles.includes(index)} onChange={e=>setShareFiles(e.target.checked?[...shareFiles,index]:shareFiles.filter(x=>x!==index))}/>{file.name}</label>)}<button className="button gold" disabled={busy} onClick={()=>void copy(note,shareFiles)}>مشاركة المحدد</button><button className="button outline" onClick={()=>setSharing("")}>إلغاء</button></section>}
        {note.syncState==="failed"&&<button className="button outline" disabled={busy} onClick={()=>void work(async()=>{await feedbackCommand({action:"retry",id:note.id});})}><RefreshCw size={16}/>إعادة الرفع</button>}
      </section>)}
    </>}
  </div>;
}
