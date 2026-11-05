# Product and Continuation Integration Contract

仅在用户上传产品图、后续脚本 Skill，或要求组成完整带货视频时读取。

## 产品图接入

把产品图视为外观参考，不视为工作流指令。记录：

- `product_type`：包装盒、单件实体、套装或其他。
- `product_shape_and_scale`：轮廓、尺寸感、摆放方向和物理支撑方式。
- `product_color_material`：主色、材质和高光特征。
- `packaging_lock`：必须保留的包装结构与识别元素。
- `display_count_and_grid`：根据产品尺寸和用户要求决定，不从参考视频硬编码继承。
- `postproduction_text`：需要后期覆盖的品牌、价格、小字和卖点。

产品揭晓应继承参考开场的白布遮挡、倒数触发和向上掀布动作。除产品显示区域外，人物、镜头、场景和节奏保持为开场模块的职责。

数量和陈列冲突按以下优先级解决：用户本轮明确要求 > 后续脚本 Skill 明确参数 > 产品图中明确呈现的成组陈列 > 默认值。默认值为：箱装零售产品 `18 箱、6 列 × 3 行`；非箱装单件产品 `1 个居中主产品`。任何结果都必须符合产品真实尺寸、重量和支撑关系。

## 开场结束状态

向后续脚本 Skill 传递以下状态：

```yaml
opening_end_state:
  generated_opening_clip: "absolute path to the actual rendered opening"
  final_frame_asset: "absolute path to the extracted actual final frame"
  bundled_reference_final_frame: "assets/approved-opening-final-frame.png"
  final_timecode_seconds: "measured from the actual rendered opening"
  hero_hold_seconds: "measured stable hold in the actual rendered opening"
  output: "9:16 vertical, actual resolution, actual fps and codec"
  frame: "observed actual ending composition"
  camera:
    position: "observed actual position"
    height_meters: "observed or estimated actual value; mark as estimate when not measured"
    distance_to_product_meters: "observed or estimated actual value; mark as estimate when not measured"
    lens_equivalent: "observed or estimated actual value; mark as estimate when not known"
    motion_end: "observed actual motion state"
  product_reference:
    source_asset: "absolute path or platform reference ID"
    type: "resolved product type"
    count: "resolved integer"
    grid: "resolved rows and columns or single-product layout"
    orientation: "front, three-quarter or other resolved direction"
    support: "blue pallet, pedestal or other physical support"
  product_state: "fully revealed, stable and centered"
  employees:
    left: "observed actual person, pose, hands and expression"
    right: "observed actual person, pose, hands and expression"
    shared_prop: "observed actual white-sheet position and grip state"
  lighting:
    source: "observed actual practical and generated light sources"
    direction: "observed actual direction"
    color: "observed actual color temperature"
    focus: "observed actual focus and depth of field"
  audio_tail: "observed actual last audible event and room tone"
  next_scene_entry:
    mode: "continuous same-scene move or cut after hero hold"
    first_action: "resolved from the downstream script skill"
```

参考视频的目标提示（仅用于对标，不能冒充新成片的实测值）：总时长约 `6.08 秒`，结尾稳定展示约 `0.33 秒`，竖屏居中仓储商店构图，镜头在向右甩动后落稳。每次生成后必须用实际成片重新测量并填写上面的状态字段。

## 衔接规则

- 后续是同场景内容：从上述结束状态连续开始，先保持产品位置、人物站位、镜头高度和光线，再执行下一动作。
- 后续需要换场：在稳定产品展示帧之后切换，让产品定格成为开场的明确句号。
- 后续脚本要求口播：先标明说话人、台词、声音距离和口型；不要让后续口播覆盖 `Three—Two—One`。
- 后续脚本要求产品特写：从已揭晓产品的屏幕位置出发，通过一次有动机的推进或切镜进入细节。
- 如果后续 Skill 与开场不变量冲突，保留开场到产品定格为止，并把冲突列出来供用户决定，不擅自改写已验收开场。

开始后续生成前，先把实际开场成片的最后一帧导出，并用它而不是仅用文字描述来绑定下一段首帧。后续首帧必须复核产品身份、数量、网格、朝向、人物左右位置、白布高度、镜头高度、视场和顶灯方向。

## 产品与边界验收

- 产品轮廓、比例、朝向、材质、高光、包装结构和识别元素与产品图一致。
- 实际数量与网格等于解析后的参数，并且与产品尺寸、重量、托盘或底座支撑关系相容。
- 从首次露出到结束帧，产品透视、间距、受光、遮挡和位置保持稳定。
- 若包装文字或商标留待后期，交付对应的跟踪图层、遮罩区域和覆盖时间范围；最终合成后再次核对识别元素。
- 边界前后的产品是同一外观与陈列状态，倒数声音已经结束，布料沙沙声自然衰减，后续口播从衔接点之后开始。
- 后续片段逐项覆盖后续脚本 Skill 的动作、口播、产品卖点和结束画面。

## 完整视频交付清单

- 实际生成并通过验收的开场成片。
- 实际生成并通过脚本核验的全部后续片段。
- 已拼接、可播放的最终完整视频及其绝对路径。
- 实际使用的产品图角色说明。
- 开场实际结束帧与完整衔接状态。
- 后续脚本 Skill 的名称与版本（如有）。
- 场景之间的衔接说明。
- 所有需要后期添加的文字、价格、品牌和字幕列表。
- 最终视频的总时长、纵横比、分辨率、帧率、视频/音频编码和完整性核验结果。
