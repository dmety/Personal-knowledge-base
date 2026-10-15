import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AppError } from "./model";
import { D1Repository } from "./repository";
export async function authorizedRepository(request?:Request,write=false){
  const user=await getChatGPTUser();if(!user)throw new AppError("请先使用 ChatGPT 登录",401);
  if(write&&request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new AppError("不接受跨站写入",403);}
  return new D1Repository(user.userId);
}
export function errorResponse(e:unknown){const status=e instanceof AppError?e.status:400;return Response.json({error:e instanceof AppError?e.message: e instanceof Error&&e.name==="ZodError"?"数据格式无效，请检查字段、网址和备份格式":"操作失败，请稍后重试"},{status,headers:{"Cache-Control":"no-store"}});}
