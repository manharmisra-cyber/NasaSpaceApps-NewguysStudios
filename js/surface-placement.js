/* Render-mesh heights, distinct from bilinear scientific elevation sampling. */
var SurfacePlacement=(function(){
  function heights(t){var out=new Float32Array(t.N*t.N),base=t.mean-t.h0;for(var j=0;j<t.N;j++)for(var i=0;i<t.N;i++){var d=Math.min(i,j,t.N-1-i,t.N-1-j),f=d>=12?1:(d/12)*(d/12)*(3-2*d/12);out[j*t.N+i]=base+(t.h[j*t.N+i]-t.h0-base)*f;}return out;}
  function sample(t,h,x,z){var u=x/t.cell+t.N/2-.5,v=z/t.cell+t.N/2-.5;if(u<0||v<0||u>t.N-1||v>t.N-1)return t.mean-t.h0;var i=Math.min(t.N-2,Math.floor(u)),j=Math.min(t.N-2,Math.floor(v)),a=u-i,b=v-j,k=j*t.N+i,A=h[k],B=h[k+1],C=h[k+t.N],D=h[k+t.N+1];return a+b<=1?A+(B-A)*a+(C-A)*b:D+(C-D)*(1-a)+(B-D)*(1-b);}
  // Translate every model vertex clear of the same triangles used by WebGL.
  function clearance(points,ground,pad){var lift=0;for(var i=0;i<points.length;i+=3)lift=Math.max(lift,ground(points[i],points[i+2])+(pad||.025)-points[i+1]);return lift;}
  return {heights:heights,sample:sample,clearance:clearance};
})();
if(typeof module!=='undefined')module.exports=SurfacePlacement;
