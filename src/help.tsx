import { useState } from "react";
import { ArrowRight, ChevronLeft, BookOpen, LayoutDashboard, Fence, Package, Wallet, ReceiptText, Users, ClipboardList, ShieldCheck, Bell, MessageSquareText } from "lucide-react";
import { guidesForRole } from "./help-content";
import type { Role } from "../functions/src/domain";
import "./help.css";
const icons:Record<string,typeof BookOpen>={"layout-dashboard":LayoutDashboard,fence:Fence,package:Package,wallet:Wallet,"receipt-text":ReceiptText,users:Users,"clipboard-list":ClipboardList,"shield-check":ShieldCheck,bell:Bell,"message-square-text":MessageSquareText};
export function HelpPanel({role}:{role:Role}) {
  const [selected,setSelected]=useState<string|null>(null),sections=guidesForRole(role),section=sections.find(s=>s.id===selected);
  return <div className="help-panel" dir="rtl">
    {section ? <>
      <button className="help-back" onClick={()=>setSelected(null)}><ArrowRight size={18}/>جميع التعليمات</button>
      <p className="eyebrow">{section.subtitle}</p><h2>{section.title}</h2>
      {section.topics.map((topic,index)=><details className="help-topic" key={topic.title} open={index===0}>
        <summary>{topic.title}<ChevronLeft size={17}/></summary>
        <ol>{topic.steps.map(step=><li key={step}>{step}</li>)}</ol>
        {topic.fields&&<div className="help-fields"><h3>البيانات التي تحتاج تعبئتها</h3>{topic.fields.map(field=><p key={field}>{field}</p>)}</div>}
        {topic.example&&<p className="notice"><b>مثال: </b>{topic.example}</p>}
        {topic.note&&<p className="help-note">{topic.note}</p>}
      </details>)}
    </> : <><p className="muted">اختر القسم لعرض الخطوات والحقول المطلوبة.</p><nav aria-label="أقسام التعليمات">{sections.map(section=>{const Icon=icons[section.icon]||BookOpen;return <button className="help-section" key={section.id} onClick={()=>setSelected(section.id)}><Icon size={22}/><span><b>{section.title}</b><small>{section.subtitle}</small></span><ChevronLeft size={18}/></button>;})}</nav></>}
  </div>;
}
