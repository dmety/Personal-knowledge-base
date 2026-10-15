import { requireChatGPTUser } from './chatgpt-auth';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <Workspace userName={user.displayName} ownerId={user.userId}/>;}
