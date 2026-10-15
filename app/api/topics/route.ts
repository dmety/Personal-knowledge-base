import { authorizedRepository, errorResponse } from "@/lib/auth";
import { changeDirectory, directoryItems, topicMutationSchema, unclassifiedCount } from "@/lib/topics";
export const dynamic="force-dynamic";
const json=(data:unknown)=>Response.json(data,{headers:{"Cache-Control":"no-store"}});
export async function GET(){try{const repo=await authorizedRepository();const directory=await repo.topics();const entries=await repo.list();return json({...directory,topics:directoryItems(directory.topics,entries),unclassified_count:unclassifiedCount(entries)});}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
  const repo=await authorizedRepository(request,true),input=topicMutationSchema.parse(await request.json());
  const directory=await repo.topics(),entries=await repo.list(),result=changeDirectory(directory,entries,input);
  await repo.commit(result.changes,"human",[],{revision:directory.revision,topics:result.topics});
  const saved=await repo.readTopics();return json({...saved,topics:directoryItems(saved.topics,await repo.list()),node_id:result.node_id});
}catch(e){return errorResponse(e);}}
