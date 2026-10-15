export type Body={id:string;x:number;y:number;vx:number;vy:number;fixed?:boolean};
export type GraphView={x:number;y:number;scale:number};
export function zoomAt(view:GraphView,scale:number,x:number,y:number){const next=Math.max(.15,Math.min(4,scale));return {x:x-(x-view.x)*next/view.scale,y:y-(y-view.y)*next/view.scale,scale:next};}
export function fitGraph(nodes:Body[],width:number,height:number):GraphView{
 if(!nodes.length)return {x:width/2,y:height/2,scale:1};const left=Math.min(...nodes.map(n=>n.x))-65,right=Math.max(...nodes.map(n=>n.x))+65,top=Math.min(...nodes.map(n=>n.y))-45,bottom=Math.max(...nodes.map(n=>n.y))+45;const scale=Math.min(1.5,Math.max(.15,Math.min((width-50)/(right-left),(height-50)/(bottom-top))));return {x:width/2-(left+right)*scale/2,y:height/2-(top+bottom)*scale/2,scale};
}
export function createBodies(ids:string[]):Body[]{return ids.map((id,i)=>({id,x:Math.cos(i*2.39996)*Math.sqrt(i+1)*40,y:Math.sin(i*2.39996)*Math.sqrt(i+1)*40,vx:0,vy:0}));}
export function stepGraph(nodes:Body[],edges:{source:string;target:string}[],distance:number,repel:number){
 const byId=new Map(nodes.map(n=>[n.id,n]));for(const n of nodes){n.vx-=n.x*.0015;n.vy-=n.y*.0015;}
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)+Math.abs(dy)<.001)dx=.1;const d=Math.max(20,Math.hypot(dx,dy)),f=Math.min(2,repel/(d*d));a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;}
 for(const e of edges){const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-distance)*.012;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
 for(const n of nodes){n.vx*=.8;n.vy*=.8;if(!n.fixed){n.x+=Math.max(-8,Math.min(8,n.vx));n.y+=Math.max(-8,Math.min(8,n.vy));}else{n.vx=0;n.vy=0;}}
}
