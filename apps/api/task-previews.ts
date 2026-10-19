import type { SelectedSkill, SkillInfo, TaskSkillPreview } from '../../packages/contracts';
import type { Database } from '../../packages/storage/database';
import { getSkillPreview } from '../../packages/domain/skill-preview';

type PreviewSelection = Pick<SelectedSkill, 'id' | 'versionId' | 'name' | 'preview'>;
export interface TaskPreviewSource { id: string; previewSkills: PreviewSelection[]; }
type PreviewFiles = SkillInfo['files'];

export function freezeSkillPreview(files: PreviewFiles): NonNullable<SelectedSkill['preview']> {
  const preview = getSkillPreview(files);
  return { imageMediaId: preview?.image?.mediaId ?? null, videoMediaId: preview?.video?.mediaId ?? null };
}

/** Batch-load exact historical versions, then apply the existing media route's current ACL. */
export async function taskSkillPreviews(db: Database, ownerId: string, tasks: TaskPreviewSource[]): Promise<Map<string, TaskSkillPreview[]>> {
  const legacyVersions = [...new Set(tasks.flatMap(task => task.previewSkills.filter(skill => !skill.preview).map(skill => skill.versionId)))];
  const filesByVersion = new Map<string, PreviewFiles>();
  if (legacyVersions.length) {
    const files = (await db.query(`SELECT f.version_id AS "versionId",f.path,f.mime,f.media_id AS "mediaId"
      FROM skill_files f JOIN skill_versions v ON v.id=f.version_id JOIN skills s ON s.id=v.skill_id
      WHERE f.version_id=ANY($1::uuid[]) AND (s.owner_id=$2 OR s.visibility='public') AND f.media_id IS NOT NULL
      AND f.mime IN ('image/png','image/jpeg','image/webp','video/mp4') ORDER BY f.version_id,f.path`, [legacyVersions, ownerId])).rows;
    for (const file of files) {
      const versionFiles = filesByVersion.get(file.versionId) ?? [];
      versionFiles.push({ path: file.path, mime: file.mime, mediaId: file.mediaId });
      filesByVersion.set(file.versionId, versionFiles);
    }
  }
  const previews = new Map(tasks.map(task => [task.id, task.previewSkills.map(skill => ({
    id: skill.id, versionId: skill.versionId, name: skill.name,
    ...(skill.preview ?? freezeSkillPreview(filesByVersion.get(skill.versionId) ?? [])),
  }))]));
  const mediaIds = [...new Set([...previews.values()].flatMap(skills => skills.flatMap(skill => [skill.imageMediaId, skill.videoMediaId]).filter((id): id is string => Boolean(id))))];
  if (!mediaIds.length) return previews;
  // Keep parity with GET /api/media/:id: a task snapshot never grants new media access.
  const readable = new Map((await db.query(`SELECT m.id,m.mime FROM media m WHERE m.id=ANY($1::uuid[]) AND
    (m.owner_id=$2 OR EXISTS(SELECT 1 FROM skill_files f JOIN skill_versions v ON f.version_id=v.id
      JOIN skills s ON v.skill_id=s.id WHERE f.media_id=m.id AND s.visibility='public'))`, [mediaIds, ownerId])).rows.map(row => [row.id, row.mime]));
  for (const skills of previews.values()) for (const skill of skills) {
    if (!skill.imageMediaId || !['image/png', 'image/jpeg', 'image/webp'].includes(readable.get(skill.imageMediaId) ?? '')) skill.imageMediaId = null;
    if (!skill.videoMediaId || readable.get(skill.videoMediaId) !== 'video/mp4') skill.videoMediaId = null;
  }
  return previews;
}
