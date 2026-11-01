import React,{useEffect,useRef,useState} from 'react';
const KEY='synapse.panel-widths.v1';
export function usePanelWidths(){
 const [saved,setSaved]=useState(()=>{try{const p=JSON.parse(localStorage.getItem(KEY))||{};return {left:Number.isFinite(p.left)?p.left:null,right:Number.isFinite(p.right)?p.right:null};}catch{return {left:null,right:null};}});
 const [viewport,setViewport]=useState(window.innerWidth);
 useEffect(()=>{const resize=()=>setViewport(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}},[saved]);
 const desktop=viewport>760,minLeft=viewport>1100?180:64;
 const root=getComputedStyle(document.documentElement),baseLeft=parseFloat(root.getPropertyValue('--sidebar'))||208,baseRight=parseFloat(root.getPropertyValue('--details'))||390;
 const left=Math.round(Math.max(minLeft,Math.min(saved.left??baseLeft,360,viewport-280-260)));
 const right=Math.round(Math.max(280,Math.min(saved.right??baseRight,680,viewport-left-260)));
 const set=(side,value)=>setSaved(old=>({...old,[side]:value}));
 return {style:desktop?{'--sidebar':left+'px','--details':right+'px'}:{},expanded:desktop&&viewport<=1100&&left>=175,handle:side=>({side,value:side==='left'?left:right,min:side==='left'?minLeft:280,max:side==='left'?Math.min(360,viewport-right-260):Math.min(680,viewport-left-260),onChange:value=>set(side,value),onReset:()=>set(side,null)})};
}
export function ResizeHandle({side,value,min,max,onChange,onReset}){
 const drag=useRef(null);const [active,setActive]=useState(false);
 const update=v=>onChange(Math.round(Math.max(min,Math.min(max,v))));
 useEffect(()=>{if(!active)return;document.documentElement.classList.add('resizing-panels');return()=>document.documentElement.classList.remove('resizing-panels');},[active]);
 const finish=()=>{drag.current=null;setActive(false);};
 return <div role="separator" tabIndex={0} aria-label={side==='left'?'왼쪽 사이드바 너비 조절':'오른쪽 사이드바 너비 조절'} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} title="드래그로 너비 조절 · 더블클릭으로 초기화" className={`panel-resizer ${side} ${active?'dragging':''}`} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,value};setActive(true);}} onPointerMove={e=>{if(drag.current)update(drag.current.value+(e.clientX-drag.current.x)*(side==='left'?1:-1));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={onReset} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();update(e.key==='Home'?min:e.key==='End'?max:value+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*(e.shiftKey?40:10));}}}><span/></div>;
}
