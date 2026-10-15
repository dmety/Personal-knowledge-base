"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export type MenuAnchor={x:number;y:number;trigger:HTMLElement};
export default function SidebarMenu({anchor,onClose,children}:{anchor:MenuAnchor;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:anchor.x,top:anchor.y});
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const rect=el.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(anchor.x,window.innerWidth-rect.width-8)),top:Math.max(8,Math.min(anchor.y,window.innerHeight-rect.height-8))});
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const outside=(e:PointerEvent)=>{if(!el.contains(e.target as Node)&&!anchor.trigger.contains(e.target as Node))onClose();};
    const reposition=()=>{if(!anchor.trigger.isConnected){onClose();return;}const trigger=anchor.trigger.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(trigger.right,window.innerWidth-rect.width-8)),top:Math.max(8,Math.min(trigger.bottom,window.innerHeight-rect.height-8))});};
    const scroll=(e:Event)=>{if(!el.contains(e.target as Node))reposition();};
    document.addEventListener("pointerdown",outside);window.addEventListener("resize",reposition);document.addEventListener("scroll",scroll,true);
    return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",reposition);document.removeEventListener("scroll",scroll,true);};
  },[anchor,onClose]);
  return createPortal(<div ref={ref} className="sidebar-menu" role="menu" style={position} onKeyDown={e=>{
    const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==="Escape"){e.preventDefault();anchor.trigger.focus();onClose();}
    if(e.key==="Tab")onClose();
    if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();items[e.key==="Home"?0:e.key==="End"?items.length-1:(index+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
  }}>{children}</div>,document.body);
}
