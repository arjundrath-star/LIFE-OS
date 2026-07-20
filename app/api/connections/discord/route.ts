import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { secret, setSecret } from "@/lib/secrets";
import { refreshAll } from "@/lib/connections";
import { getHub } from "@/server/live";
import { validateDiscordBot } from "@/lib/connections/discord";
export const dynamic="force-dynamic";
const numericIds=(value:string)=>value.split(",").map(v=>v.trim()).filter(Boolean);
export async function GET(){ if(!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401}); const app=secret("DISCORD_APPLICATION_ID"); const installUrl=app&&/^\d{15,22}$/.test(app)?`https://discord.com/oauth2/authorize?client_id=${app}&scope=bot%20applications.commands&permissions=66560`:null; return NextResponse.json({configured:!!secret("DISCORD_BOT_TOKEN")&&!!secret("DISCORD_WATCH_CHANNEL_IDS"),applicationConfigured:!!installUrl,installUrl,developerUrl:"https://discord.com/developers/applications"}); }
export async function POST(req:Request){ if(!(await requireUser())) return NextResponse.json({error:"unauthorized"},{status:401}); const body=await req.json(); const token=String(body.token||"").trim(); const ids=numericIds(String(body.channelIds||"")); if(token.length<20) return NextResponse.json({error:"A valid bot token is required."},{status:400}); if(ids.length===0||ids.some(id=>!/^\d{15,22}$/.test(id))) return NextResponse.json({error:"Channel IDs must be comma-separated numeric Discord snowflakes."},{status:400}); try{await validateDiscordBot(token,ids);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Discord validation failed."},{status:422});} setSecret("DISCORD_BOT_TOKEN",token); setSecret("DISCORD_WATCH_CHANNEL_IDS",ids.join(",")); const states=await refreshAll(); getHub().broadcast("connections",states); return NextResponse.json({ok:true,connections:states}); }
