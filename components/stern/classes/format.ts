export function formatDue(value:string){
  if(!value)return 'No due date';
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  const date=new Date(dateOnly?`${value}T12:00:00Z`:value);
  if(!Number.isFinite(date.getTime()))return value;
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',...(dateOnly?{}:{hour:'numeric',minute:'2-digit'})}).format(date);
}
export const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export function percent(value:number|null){return value===null?'No grades yet':`${value.toFixed(1)}%`;}
