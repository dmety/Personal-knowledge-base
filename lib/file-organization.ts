import { z } from "zod";
import { AppError, type Entry } from "./model";
import { topicPaths, topicIdsForPaths, type Directory } from "./topics";

export const fileOperationSchema=z.object({action:z.literal("organize"),id:z.string(),version:z.number().int().positive(),revision:z.number().int().nonnegative(),operation:z.enum(["move","remove","archive"]),source_topic_id:z.string(),target_topic_id:z.string().optional()});
export type FileOperation=z.infer<typeof fileOperationSchema>;
export function organizeRecord(before:Entry,directory:Directory,input:FileOperation){
  if(input.version!==before.version||input.revision!==directory.revision)throw new AppError("记录或主题目录已变化，请刷新后重试",409);
  if(before.organization_proposal||before.revision_of||before.status==="archived")throw new AppError("请选择未归档的知识记录");
  const paths=topicPaths(directory.topics),source=paths.get(input.source_topic_id);
  if(!source||!before.topic_paths.includes(source))throw new AppError("记录已不属于此主题，请刷新后重试",409);
  let topic_paths=before.topic_paths;
  if(input.operation!=="archive"){
    topic_paths=topic_paths.filter(p=>p!==source);
    if(input.operation==="move"){
      const target=paths.get(input.target_topic_id||"");if(!target)throw new AppError("请选择现有目标主题");
      if(target===source)throw new AppError("目标主题与当前主题相同");
      topic_paths=[...new Set([...topic_paths,target])];
    }
  }
  return {before,after:{...before,topic_paths,topic_ids:topicIdsForPaths(topic_paths,directory.topics),status:input.operation==="archive"?"archived" as const:before.status,version:before.version+1,updated_at:new Date().toISOString()},action:input.operation==="move"?"移动记录主题":input.operation==="remove"?"移出当前主题":"归档记录"};
}
