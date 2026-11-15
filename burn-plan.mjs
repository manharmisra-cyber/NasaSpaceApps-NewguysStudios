export function burnPlan(p,c,b){
 const geometry=p.goal==='orbit'||c.distance<=p.radius;
 return b.burns.map((x,i,all)=>{
  const terminal=p.goal==='land'&&i===all.length-1;
  const issues=[];if(!geometry)issues.push('Selected pin is not reached');if(!b.fuelOK||!x.fuelValid)issues.push('Fuel budget fails');if(!b.thrustOK)issues.push('Minimum-mass hover check fails');if(terminal)issues.push('Powered descent and ignition not solved');if(x.kind==='conditional')issues.push('Earth encounter targeting not solved');if(b.longBurn)issues.push('Long burn: impulse approximation weak');
  // A time-centred allocation is a planning estimate, never a propagated guidance solution.
  const start=terminal||!geometry||!x.fuelValid?null:x.time-x.duration/2,end=start===null?null:start+x.duration;
  if(start!==null&&i>0&&start<all[i-1].time+all[i-1].duration/2)issues.push('Burn allocations overlap');
  if(start!==null&&x.kind!=='conditional'&&start<p.epoch)issues.push('Allocation starts before the lunar orbit epoch');
  return {...x,start,end,terminal,issues,remainingPropellant:x.after-p.dry,unreservedPropellant:x.after-p.dry-b.reserved,accelerationStart:p.thrust*1000/x.before,accelerationEnd:p.thrust*1000/x.after,status:'Planning estimate; not flight guidance'};
 });
}
export function burnCsv(rows){const utc=x=>x===null?'UNSOLVED':new Date(x*1000).toISOString(),quote=x=>'"'+String(x).replaceAll('"','""')+'"';return [['burn','ideal_event_utc','estimated_start_utc','estimated_end_utc','duration_s','delta_v_m_s','propellant_kg','remaining_propellant_kg','unreserved_propellant_kg','initial_accel_m_s2','final_accel_m_s2','status','issues'],...rows.map(x=>[x.name,utc(x.time),utc(x.start),utc(x.end),x.duration,x.dv,x.propellant,x.remainingPropellant,x.unreservedPropellant,x.accelerationStart,x.accelerationEnd,x.status,x.issues.join('; ')])].map(row=>row.map(quote).join(',')).join('\n');}
