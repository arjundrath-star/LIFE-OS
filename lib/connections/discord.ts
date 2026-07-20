export type DiscordValidation = { botName:string; channelCount:number };
async function discordGet(path:string,token:string,request:typeof fetch,timeoutMs:number){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await request(`https://discord.com/api/v10${path}`,{headers:{authorization:`Bot ${token}`},signal:controller.signal});}finally{clearTimeout(timer);}}
export async function validateDiscordBot(token:string,channelIds:string[],request:typeof fetch=fetch,timeoutMs=3500):Promise<DiscordValidation>{
  let identity:Response;try{identity=await discordGet("/users/@me",token,request,timeoutMs);}catch{throw new Error("Discord bot validation timed out or could not reach Discord.");}
  if(!identity.ok)throw new Error(identity.status===401?"Discord rejected the bot token.":`Discord bot identity check failed (${identity.status}).`);
  const bot=await identity.json() as {bot?:boolean;username?:string};if(bot.bot!==true)throw new Error("Discord credential is not an official bot token.");
  for(const id of channelIds){let channel:Response;try{channel=await discordGet(`/channels/${id}`,token,request,timeoutMs);}catch{throw new Error(`Discord channel ${id} access check timed out.`);}if(!channel.ok)throw new Error(channel.status===403||channel.status===404?`Bot cannot access watched channel ${id}.`:`Discord channel ${id} check failed (${channel.status}).`);}
  return {botName:bot.username||"bot",channelCount:channelIds.length};
}
