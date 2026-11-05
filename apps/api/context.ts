import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../packages/storage/database';
import type { User } from '../../packages/contracts';
import type { ProductCatalogOptions } from './product-catalog-store';

export interface AppContext { db: Database; dataRoot: string; masterKey: string; setupKey: string; origin: string; testMode?: boolean; singleUserMode?: boolean; catalog?: ProductCatalogOptions; }
export interface AuthRequest extends FastifyRequest { user: User; csrf: string; }
declare module 'fastify' { interface FastifyRequest { user: User; csrf: string; } }
export class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export function owner(resource: { owner_id: string } | undefined, user: User) {
  if (!resource || resource.owner_id !== user.id) throw new AppError(404, '资料不存在或无权访问');
  return resource;
}
export function admin(request: FastifyRequest) { if (request.user.role !== 'admin') throw new AppError(403, '需要管理员权限'); }
export type Routes = (app: FastifyInstance, context: AppContext) => Promise<void>;
