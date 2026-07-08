import type { ContentItem, ContentType } from '../../types/jupyter';

type JupyterContentItem = ContentItem & {
  type?: ContentType;
};

export interface TreeNode extends ContentItem {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export function normalizeContentItems(items: ContentItem[]): TreeNode[] {
  return items
    .map((item) => {
      const rawItem = item as JupyterContentItem;

      return {
        ...item,
        content_type: item.content_type ?? rawItem.type,
        isExpanded: false,
        isLoading: false,
      };
    })
    .sort((a, b) => {
      if (a.content_type === 'directory' && b.content_type !== 'directory') {
        return -1;
      }
      if (a.content_type !== 'directory' && b.content_type === 'directory') {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
}
