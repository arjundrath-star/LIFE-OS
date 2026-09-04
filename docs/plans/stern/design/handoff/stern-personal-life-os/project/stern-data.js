// Stern placeholder data and status vocabulary
export const C = { ok:'#16A34A', warn:'#D97706', error:'#DC2626', info:'#2563EB', off:'#9CA3AF', accent:'#57068C', neutral:'#5B5B70' };
export const TONE = {
  Considering:'off', Applying:'accent', Interviewing:'info', Accepted:'ok', Rejected:'error', Declined:'off', Archived:'off',
  'Not open':'off', Open:'info', Drafting:'accent', Submitted:'info', 'Interview invited':'warn', 'Interview done':'info', Withdrawn:'off', Missed:'error',
  'To request':'warn', Requested:'info', 'Reply received':'accent', Scheduled:'info', Done:'ok', 'Thank-you sent':'ok', 'No reply':'warn',
  Met:'neutral', 'Need to reach out':'warn', 'Reached out':'info', Replied:'accent', Chatted:'ok', 'Follow-up owed':'warn', Dormant:'off',
  Dropped:'off', Upcoming:'neutral', 'In progress':'accent', Graded:'ok', Academic:'neutral', Professional:'neutral', Campus:'neutral',
  'Not started':'off', Applied:'info', Interview:'warn'
};
export const chip = l => ({ label:l, dot:C[TONE[l] || 'neutral'] });
export const NAV = ['Overview','Club Recruiting','Network','Tasks','Classes','Career','Automation'];
export const NAV_SHORT = ['Ov','Cl','Ne','Ta','Cs','Ca','Au'];

export const PEOPLE = [
  { n:'Priya Natarajan', aff:'Strategic Venture Society', role:'President', eb:true, rel:'Club connect', s:3, st:'Chatted', last:'2h ago', next:'Send thank-you by 4:00 PM', c:[1,1,1,1], sel:true },
  { n:'Daniel Okafor', aff:'Entrepreneurial Exchange Group', role:'Director of Ops', eb:true, rel:'Club connect', s:2, st:'Replied', last:'2h ago', next:'Reply to Daniel', c:[1,0,1,1], hover:true },
  { n:'Maya Lindqvist', aff:'Finance Society', role:'Analyst Program Lead', eb:true, rel:'Club connect', s:1, st:'Need to reach out', last:'—', next:'Send coffee chat request', c:[1,0,0,1] },
  { n:'Rohan Mehta', aff:'Blockchain and Fintech Club', role:'Member', eb:false, rel:'Club connect', s:2, st:'Reached out', last:'3d ago', next:'Wait for reply', c:[1,1,1,0] },
  { n:'Elena Marchetti', aff:'NYU Stern', role:'Professor, STAT-UB 103', eb:false, rel:'Professor', s:2, st:'Met', last:'4d ago', next:'Office hours Thu', c:[1,0,0,0] },
  { n:'Sam Delacroix', aff:'NYU Stern', role:'Transfer, Class of 2028', eb:false, rel:'Friend', s:5, st:'Chatted', last:'1d ago', next:'—', c:[1,1,1,1] },
  { n:'Jordan Whitfield', aff:'Strategic Venture Society', role:'VP Recruiting', eb:true, rel:'Club connect', s:3, st:'Follow-up owed', last:'6d ago', next:'Send follow-up note', c:[1,0,1,1] },
  { n:'Aisha Bello', aff:'Stern Undergraduate Advising', role:'Academic Advisor', eb:false, rel:'Mentor', s:4, st:'Chatted', last:'8d ago', next:'Book Sept check-in', c:[1,1,0,0] },
  { n:'Tomás Reyes', aff:'Business Analytics Club', role:'Co-President', eb:true, rel:'Club connect', s:1, st:'Reached out', last:'1d ago', next:'Wait for reply', c:[1,0,1,0] },
  { n:'Grace Huang', aff:'Goldman Sachs', role:'Analyst', eb:false, rel:'Professional', s:2, st:'Dormant', last:'62d ago', next:'Reconnect in Oct', c:[1,0,0,1] },
  { n:'Leo Castellanos', aff:'Strategic Venture Society', role:'Treasurer', eb:true, rel:'Club connect', s:1, st:'Need to reach out', last:'—', next:'Draft coffee chat email', c:[1,0,1,0] },
  { n:'Noah Feldman', aff:'Stern Jewish Business Association', role:'VP Programming', eb:true, rel:'General connect', s:1, st:'Dormant', last:'40d ago', next:'—', c:[0,0,1,0] }
];

export const TASKS = [
  { title:'Today', count:'4', rows:[
    { t:'Send thank-you email to Priya Natarajan', ent:'Priya Natarajan', due:'Sept 4, 4:00 PM', pri:C.error, src:'Suggested' },
    { t:'Reply to Daniel Okafor about EEG coffee chat', ent:'Daniel Okafor', due:'Sept 4', pri:C.error, src:'Auto (email)' },
    { t:'Problem set 1', ent:'STAT-UB 103', due:'Sept 4, 11:59 PM', pri:C.warn, src:'Auto (email)' },
    { t:'Draft coffee chat request to Maya Lindqvist', ent:'Finance Society', due:'Sept 4', pri:C.warn, src:'Manual' } ] },
  { title:'This week', count:'4', rows:[
    { t:'RSVP to general meeting', ent:'Finance Society', due:'Sept 7', pri:C.warn, src:'Manual' },
    { t:'Case reading: Ch. 2', ent:'MKTG-UB 1', due:'Sept 8', pri:C.off, src:'Auto (email)' },
    { t:'Reading quiz 1', ent:'TECH-UB 1', due:'Sept 9', pri:C.warn, src:'Auto (email)' },
    { t:'Attend info session', ent:'Blockchain and Fintech Club', due:'Sept 11, 6:00 PM', pri:C.off, src:'Auto (calendar)' } ] },
  { title:'Later', count:'3', rows:[
    { t:'Reflection 1', ent:'CAMS-UA 110', due:'Sept 16', pri:C.off, src:'Auto (email)' },
    { t:'Draft Exploratory application', ent:'Strategic Venture Society', due:'Sept 18', pri:C.warn, src:'Manual' },
    { t:'Interview prep: 3 mock questions', ent:'Strategic Venture Society', due:'Sept 21', pri:C.off, src:'Manual' } ] },
  { title:'No date', count:'2', rows:[
    { t:'Update resume with summer internship', ent:'', due:'—', pri:C.off, src:'Manual' },
    { t:'Ask about spring registration window', ent:'Aisha Bello', due:'—', pri:C.off, src:'Manual' } ] }
];

export const ASSIGNMENTS = [
  { title:'Upcoming', rows:[
    { t:'Problem set 2', type:'Homework', due:'Sept 11, 11:59 PM', pts:'20 pts', src:'Auto (email)' },
    { t:'Quiz 1: Descriptive statistics', type:'Quiz', due:'Sept 18, in class', pts:'10 pts', src:'Manual' } ] },
  { title:'In progress', rows:[ { t:'Problem set 1', type:'Homework', due:'Sept 4, 11:59 PM', pts:'20 pts', src:'Auto (email)' } ] },
  { title:'Submitted', rows:[ { t:'Syllabus quiz', type:'Quiz', due:'Sept 2', pts:'5 pts', src:'Manual' } ] },
  { title:'Graded', rows:[ { t:'Intro survey', type:'Participation', due:'Aug 31', pts:'2 / 2 pts', src:'Auto (email)' } ] }
];

export const PIPELINE = [
  { org:'Henry.ai', role:'Product intern, Summer 2027', stage:'Applied', dl:'Oct 15', last:'23d ago', next:'Wait for response' },
  { org:'Tessera Labs', role:'Growth analyst intern', stage:'Not started', dl:'Nov 1', last:'—', next:'Ask Grace Huang for intro' },
  { org:'Pear VC Fellows', role:'Fellow, Spring cohort', stage:'Applied', dl:'Sept 30', last:'12d ago', next:'Follow up after Oct 4' },
  { org:'OpenAI Student Collective', role:'Campus ambassador', stage:'Interview', dl:'Sept 25', last:'5d ago', next:'Prep 30 min, week of Sept 21' },
  { org:'Engine Ventures', role:'Sourcing intern', stage:'Not started', dl:'Rolling', last:'—', next:'Draft outreach in Oct' },
  { org:'Klade', role:'Operations intern', stage:'Rejected', dl:'—', last:'30d ago', next:'Archive' }
];

export const AUDIT = [
  { time:'09:05', ent:'Rohan Mehta', before:'Reached out', after:'Replied', src:'Auto (iMessage)' },
  { time:'08:40', ent:'Blockchain and Fintech Club', before:'No event', after:'Info session, Sept 11', src:'Auto (calendar)' },
  { time:'08:12', ent:'Jane Park', before:'Reached out', after:'Replied', src:'Auto (email)' },
  { time:'Sept 3, 17:22', ent:'STAT-UB 103 · Problem set 1', before:'Sept 3', after:'Sept 4', src:'Auto (email)' },
  { time:'Sept 3, 14:05', ent:'Priya Natarajan', before:'Requested', after:'Scheduled', src:'Auto (calendar)' },
  { time:'Sept 2, 21:48', ent:'Jordan Whitfield', before:'Chatted', after:'Thank-you sent', src:'Manual' }
];

export const SVS_TL = [
  { when:'Today, 11:00', text:'Coffee chat with Priya Natarajan ended', src:'Auto (calendar)' },
  { when:'Today, 08:12', text:'Jordan Whitfield replied to thank-you', src:'Auto (email)' },
  { when:'Sept 3, 14:05', text:'Coffee chat with Priya scheduled for Sept 4', src:'Auto (calendar)' },
  { when:'Sept 2, 21:48', text:'Thank-you sent to Jordan Whitfield', src:'Manual' },
  { when:'Sept 2, 19:30', text:'Attended general meeting, KMC 2-60', src:'Manual' }
];
export const PRIYA_TL = [
  { when:'Today, 11:00', text:'Coffee chat, Kimmel 4th floor', src:'Auto (calendar)' },
  { when:'Sept 3, 14:05', text:'Reply received, chat scheduled', src:'Auto (email)' },
  { when:'Sept 2, 22:10', text:'Coffee chat requested by email', src:'Manual' },
  { when:'Sept 2, 19:30', text:'Met at SVS general meeting', src:'Manual' }
];

export const SHEET = [
  { title:'Club', chips:['Considering','Applying','Interviewing','Accepted','Rejected','Declined','Archived'] },
  { title:'Program', chips:['Not open','Open','Drafting','Submitted','Interview invited','Interview done','Accepted','Rejected','Declined','Withdrawn','Missed'] },
  { title:'Coffee chat', chips:['To request','Requested','Reply received','Scheduled','Done','Thank-you sent','No reply','Declined'] },
  { title:'Person status', chips:['Met','Need to reach out','Reached out','Replied','Chatted','Follow-up owed','Dormant'] },
  { title:'Task', chips:['Open','Done','Dropped'] },
  { title:'Assignment', chips:['Upcoming','In progress','Submitted','Graded'] }
];
export const REL = ['Friend','General connect','Club connect','Mentor','Professional','Professor'];
export const DOMAINS = ['Academic','Professional','Campus'];
export const SOURCES = ['Manual','Auto (email)','Auto (calendar)','Auto (iMessage)','Suggested'];
