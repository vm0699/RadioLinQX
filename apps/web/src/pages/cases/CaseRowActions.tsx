import { useState } from 'react';
import { Button, Dropdown, Popover, Select, Tooltip, App as AntdApp } from 'antd';
import {
  EditOutlined,
  ShareAltOutlined,
  CloudDownloadOutlined,
  MessageOutlined,
  TagsOutlined,
  CopyOutlined,
  EyeOutlined,
  MoreOutlined,
  HistoryOutlined,
  LinkOutlined,
  FileTextOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { api, type CaseView, type AppSettings } from '../../api/client';
import { CaseChatPopover } from './CaseChatPopover';
import { CaseHistoryPopover } from './CaseHistoryPopover';
import { LinkCasesPopover } from './LinkCasesPopover';

export function CaseRowActions({
  c,
  settings,
  onChanged,
  onView,
  onEdit,
  onOpenDrawer,
}: {
  c: CaseView;
  settings: AppSettings | null;
  onChanged: () => void;
  onView: (c: CaseView) => void;
  onEdit: (c: CaseView) => void;
  onOpenDrawer: (id: string) => void;
}) {
  const { message, modal } = AntdApp.useApp();
  const [tags, setTags] = useState<string[]>(c.tags);
  const [savingTags, setSavingTags] = useState(false);
  const reported = c.status === 'REPORTED';

  const shareLink = `${location.origin}/?case=${c.id}`;

  const doShare = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      message.success('Case link copied');
    } catch {
      modal.info({ title: 'Share link', content: shareLink });
    }
  };

  const doDuplicate = async () => {
    const dup = await api.duplicateCase(c.id);
    message.success(`Duplicated → ${dup.caseNumber}`);
    onChanged();
  };

  const saveTags = async (next: string[]) => {
    setTags(next);
    setSavingTags(true);
    try {
      await api.updateCase(c.id, { tags: next });
      onChanged();
    } finally {
      setSavingTags(false);
    }
  };

  const tagEditor = (
    <div style={{ width: 260 }}>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        value={tags}
        onChange={saveTags}
        loading={savingTags}
        placeholder="Add / remove tags"
        options={(settings?.tags ?? []).map((t) => ({ value: t, label: t }))}
      />
    </div>
  );

  const iconBtn = (
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip title={title}>
      <Button size="small" type="text" icon={icon} disabled={disabled} onClick={onClick} />
    </Tooltip>
  );

  const popBtn = (title: string, icon: React.ReactNode, content: React.ReactNode) => (
    <Popover trigger="click" placement="bottomRight" content={content}>
      <Tooltip title={title}>
        <Button size="small" type="text" icon={icon} />
      </Tooltip>
    </Popover>
  );

  return (
    <div className="row-actions">
      {iconBtn('View series', <EyeOutlined />, () => onView(c), !c.hasImages)}
      {iconBtn('Edit case', <EditOutlined />, () => onEdit(c))}
      {iconBtn('Copy share link', <ShareAltOutlined />, doShare)}
      {iconBtn('Download case (DICOM + report)', <CloudDownloadOutlined />, () =>
        window.open(api.caseDownloadUrl(c.id), '_blank'),
      )}
      {reported &&
        iconBtn('Download report', <FileTextOutlined />, () =>
          window.open(api.caseReportTxtUrl(c.id), '_blank'),
        )}

      {popBtn('Case chat', <MessageOutlined />, <CaseChatPopover caseId={c.id} onPosted={onChanged} />)}
      {popBtn(
        'Link related cases',
        <LinkOutlined />,
        <LinkCasesPopover theCase={c} onChanged={onChanged} />,
      )}
      {popBtn('Tags', <TagsOutlined />, tagEditor)}

      {iconBtn('Duplicate case', <CopyOutlined />, doDuplicate)}

      {reported &&
        popBtn('Case history', <HistoryOutlined />, <CaseHistoryPopover caseId={c.id} />)}

      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'open', label: 'Open case details' },
            { key: 'assign', label: 'Assign radiologist' },
            { key: 'word', label: 'Edit report in Word', icon: <FileWordOutlined style={{ color: '#2563EB' }} /> },
            reported
              ? { key: 'reopen', label: 'Reopen (mark pending)' }
              : { key: 'report', label: 'Open report editor' },
            { key: 'history', label: 'View history' },
            { type: 'divider' },
            { key: 'delete', label: 'Delete', danger: true },
          ],
          onClick: async ({ key }) => {
            if (key === 'word') {
              try {
                const docxUrl = api.caseReportDocxUrl(c.id);
                const absoluteUrl = docxUrl.startsWith('http')
                  ? docxUrl
                  : `${window.location.origin}${docxUrl}`;
                window.location.href = `ms-word:ofe|u|${absoluteUrl}`;
                api.openInWord(c.id).catch(() => {});
                onOpenDrawer(c.id);
                message.success(`Launching Word for ${c.caseNumber}... Press Ctrl+S to auto-sync!`);
              } catch (err: any) {
                message.error(`Failed to launch Word: ${err.message || err}`);
              }
            }
            if (key === 'open' || key === 'report' || key === 'assign' || key === 'history')
              onOpenDrawer(c.id);
            if (key === 'reopen') {
              await api.updateCase(c.id, { status: 'ASSIGNED', reportedAt: undefined });
              onChanged();
            }
            if (key === 'delete') {
              modal.confirm({
                title: `Delete ${c.caseNumber}?`,
                okType: 'danger',
                onOk: async () => {
                  await api.deleteCase(c.id);
                  message.success('Deleted');
                  onChanged();
                },
              });
            }
          },
        }}
      >
        <Button size="small" type="text" icon={<MoreOutlined />} />
      </Dropdown>
    </div>
  );
}
