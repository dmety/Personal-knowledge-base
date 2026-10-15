import {authorizedRepository,errorResponse} from "@/lib/auth";
import {defaultPersonalProfile,personalProfileSchema} from "@/lib/personal-profile";
import {AppError} from "@/lib/model";
export const dynamic="force-dynamic";
const json=(v:unknown)=>Response.json(v,{headers:{"Cache-Control":"no-store"}});
export async function GET(){try{const repo=await authorizedRepository();return json({profile:await repo.readProfile()||defaultPersonalProfile()});}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{const repo=await authorizedRepository(request,true);if(Number(request.headers.get("content-length"))>1024*1024)throw new AppError("背景内容过长",413);const profile=personalProfileSchema.parse(await request.json());return json({profile:await repo.writeProfile(profile)});}catch(e){return errorResponse(e);}}
