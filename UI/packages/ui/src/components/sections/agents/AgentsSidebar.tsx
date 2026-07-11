import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { isMobileDeviceViaCSS } from '@/lib/device';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useAgentsStore, isAgentBuiltIn, isAgentHidden, type AgentScope, type AgentDraft } from '@/stores/useAgentsStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { Agent } from '@opencode-ai/sdk/v2';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';
import { SidebarGroup } from '@/components/sections/shared/SidebarGroup';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { SUPLAGENTICS_AGENT_NAMES } from '@/lib/suplagentics/agentNames';

interface AgentsSidebarProps {
  onItemSelect?: () => void;
}

type PermissionAction = 'allow' | 'ask' | 'deny';
type PermissionRule = { permission: string; pattern: string; action: PermissionAction };

type PermissionConfigValue = PermissionAction | Record<string, PermissionAction>;

const toPermissionRuleset = (ruleset: unknown): PermissionRule[] => {
  if (!Array.isArray(ruleset)) {
    return [];
  }

  const parsed: PermissionRule[] = [];
  for (const entry of ruleset) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Partial<PermissionRule>;
    if (typeof candidate.permission !== 'string' || typeof candidate.pattern !== 'string' || typeof candidate.action !== 'string') {
      continue;
    }
    if (candidate.action !== 'allow' && candidate.action !== 'ask' && candidate.action !== 'deny') {
      continue;
    }
    parsed.push({ permission: candidate.permission, pattern: candidate.pattern, action: candidate.action });
  }

  return parsed;
};

const normalizeRuleset = (ruleset: PermissionRule[]): PermissionRule[] => {
  const map = new Map<string, PermissionRule>();
  for (const rule of ruleset) {
    if (!rule.permission || rule.permission === 'invalid') {
      continue;
    }
    if (!rule.pattern) {
      continue;
    }
    map.set(`${rule.permission}::${rule.pattern}`, rule);
  }
  return Array.from(map.values());
};

const rulesetToPermissionConfig = (ruleset: unknown): AgentDraft['permission'] => {
  const parsed = normalizeRuleset(toPermissionRuleset(ruleset));
  if (parsed.length === 0) {
    return undefined;
  }

  const byPermission: Record<string, Record<string, PermissionAction>> = {};
  for (const rule of parsed) {
    if (!rule.permission) {
      continue;
    }
    (byPermission[rule.permission] ||= {})[rule.pattern] = rule.action;
  }

  const result: Record<string, PermissionConfigValue> = {};
  for (const [permissionName, map] of Object.entries(byPermission)) {
    const patterns = Object.keys(map);
    if (patterns.length === 1 && patterns[0] === '*') {
      result[permissionName] = map['*'];
      continue;
    }
    result[permissionName] = map;
  }

  return Object.keys(result).length > 0 ? (result as AgentDraft['permission']) : undefined;
};

export const AgentsSidebar: React.FC<AgentsSidebarProps> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const [renameDialogAgent, setRenameDialogAgent] = React.useState<Agent | null>(null);
  const [renameNewName, setRenameNewName] = React.useState('');
  const [confirmActionAgent, setConfirmActionAgent] = React.useState<Agent | null>(null);
  const [confirmActionType, setConfirmActionType] = React.useState<'delete' | 'reset' | null>(null);
  const [isConfirmActionPending, setIsConfirmActionPending] = React.useState(false);
  const [openMenuAgent, setOpenMenuAgent] = React.useState<string | null>(null);
  const [bulkToggleAction, setBulkToggleAction] = React.useState<'disable' | 'enable' | null>(null);
  const [isBulkToggling, setIsBulkToggling] = React.useState(false);
  const [bulkToggleProgress, setBulkToggleProgress] = React.useState<{ current: number; total: number; phase: string } | null>(null);

  const {
    selectedAgentName,
    agents,
    setSelectedAgent,
    setAgentDraft,
    createAgent,
    deleteAgent,
    loadAgents,
  } = useAgentsStore(useShallow((s) => ({
    selectedAgentName: s.selectedAgentName,
    agents: s.agents,
    setSelectedAgent: s.setSelectedAgent,
    setAgentDraft: s.setAgentDraft,
    createAgent: s.createAgent,
    deleteAgent: s.deleteAgent,
    loadAgents: s.loadAgents,
  })));

  React.useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const bgClass = 'bg-background';

  const handleCreateNew = () => {
    // Generate unique name
    const baseName = 'new-agent';
    let newName = baseName;
    let counter = 1;
    while (agents.some((a) => a.name === newName)) {
      newName = `${baseName}-${counter}`;
      counter++;
    }

    // Set draft and open the page for editing
    setAgentDraft({ name: newName, scope: 'user' });
    setSelectedAgent(newName);
    onItemSelect?.();

  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (isAgentBuiltIn(agent)) {
      toast.error(t('settings.agents.sidebar.toast.builtInCannotDelete'));
      return;
    }

    setConfirmActionAgent(agent);
    setConfirmActionType('delete');
  };

  const handleResetAgent = async (agent: Agent) => {
    if (!isAgentBuiltIn(agent)) {
      return;
    }

    setConfirmActionAgent(agent);
    setConfirmActionType('reset');
  };

  const closeConfirmActionDialog = () => {
    setConfirmActionAgent(null);
    setConfirmActionType(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmActionAgent || !confirmActionType) {
      return;
    }

    setIsConfirmActionPending(true);
    try {
      const result = await deleteAgent(confirmActionAgent.name, (confirmActionAgent as Agent & { scope?: AgentScope }).scope);

      if (result.ok) {
        if (result.requiresManualRestart) {
          toast.warning(t('settings.agents.page.toast.savedManualRestart'));
        } else if (confirmActionType === 'delete') {
          toast.success(t('settings.agents.sidebar.toast.agentDeleted', { name: confirmActionAgent.name }));
        } else {
          toast.success(t('settings.agents.sidebar.toast.agentReset', { name: confirmActionAgent.name }));
        }
        closeConfirmActionDialog();
      } else if (confirmActionType === 'delete') {
        toast.error(t('settings.agents.sidebar.toast.deleteFailed'));
      } else {
        toast.error(t('settings.agents.sidebar.toast.resetFailed'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const definitionMissing = /built-in|not deletable|not found/i.test(message);
      if (confirmActionType === 'delete') {
        toast.error(definitionMissing
          ? t('settings.agents.sidebar.toast.definitionNotFound')
          : t('settings.agents.sidebar.toast.deleteFailed'));
      } else {
        toast.error(t('settings.agents.sidebar.toast.resetFailed'));
      }
    }

    setIsConfirmActionPending(false);
  };

  const handleDuplicateAgent = (agent: Agent) => {
    const baseName = agent.name;
    let copyNumber = 1;
    let newName = `${baseName}-copy`;

    while (agents.some((a) => a.name === newName)) {
      copyNumber++;
      newName = `${baseName}-copy-${copyNumber}`;
    }

    // Set draft with prefilled values from source agent
    const extAgent = agent as Agent & { scope?: AgentScope };
    const modelStr = agent.model?.providerID && agent.model?.modelID
      ? `${agent.model.providerID}/${agent.model.modelID}`
      : null;
    const draftAgent = agent as Agent & { disable?: boolean };
    setAgentDraft({
      name: newName,
      scope: extAgent.scope || 'user',
      description: agent.description,
      model: modelStr,
      variant: agent.variant,
      temperature: agent.temperature,
      top_p: agent.topP,
      prompt: agent.prompt,
      mode: agent.mode,
      permission: rulesetToPermissionConfig(agent.permission),
      disable: draftAgent.disable,
    });
    setSelectedAgent(newName);

  };

  const handleOpenRenameDialog = (agent: Agent) => {
    setRenameNewName(agent.name);
    setRenameDialogAgent(agent);
  };

  const handleRenameAgent = async () => {
    if (!renameDialogAgent) return;

    const sanitizedName = renameNewName.trim().replace(/\s+/g, '-');

    if (!sanitizedName) {
      toast.error(t('settings.agents.sidebar.toast.agentNameRequired'));
      return;
    }

    if (sanitizedName === renameDialogAgent.name) {
      setRenameDialogAgent(null);
      return;
    }

    if (agents.some((a) => a.name === sanitizedName)) {
      toast.error(t('settings.agents.sidebar.toast.agentExists'));
      return;
    }

    // Create new agent with new name and all existing config
    const renameModelStr = renameDialogAgent.model?.providerID && renameDialogAgent.model?.modelID
      ? `${renameDialogAgent.model.providerID}/${renameDialogAgent.model.modelID}`
      : null;
    const renameExt = renameDialogAgent as Agent & { scope?: AgentScope; disable?: boolean };
    const createResult = await createAgent({
      name: sanitizedName,
      description: renameDialogAgent.description,
      model: renameModelStr,
      variant: renameDialogAgent.variant,
      temperature: renameDialogAgent.temperature,
      top_p: renameDialogAgent.topP,
      prompt: renameDialogAgent.prompt,
      mode: renameDialogAgent.mode,
      permission: rulesetToPermissionConfig(renameDialogAgent.permission),
      disable: renameExt.disable,
      scope: renameExt.scope,
    });

    if (createResult.ok) {
      // Delete old agent
      const deleteResult = await deleteAgent(renameDialogAgent.name, renameExt.scope);
      if (deleteResult.ok) {
        if (createResult.requiresManualRestart || deleteResult.requiresManualRestart) {
          toast.warning(t('settings.agents.page.toast.savedManualRestart'));
        } else {
          toast.success(t('settings.agents.sidebar.toast.agentRenamed', { name: sanitizedName }));
        }
        setSelectedAgent(sanitizedName);
      } else {
        toast.error(t('settings.agents.sidebar.toast.removeOldAfterRenameFailed'));
      }
    } else {
      toast.error(t('settings.agents.sidebar.toast.renameFailed'));
    }

    setRenameDialogAgent(null);
  };

  const getAgentModeIcon = (mode?: string) => {
    switch (mode) {
      case 'primary':
        return <Icon name="ai-agent" className="h-3 w-3 text-primary" />;
      case 'all':
        return <Icon name="ai-agent-fill" className="h-3 w-3 text-primary" />;
      case 'subagent':
        return <Icon name="robot" className="h-3 w-3 text-primary" />;
      default:
        return null;
    }
  };

  // Filter out hidden agents (internal agents like title, compaction, summary)
  const visibleAgents = agents.filter((agent) => !isAgentHidden(agent));
  const builtInAgents = visibleAgents.filter(isAgentBuiltIn);
  const customAgents = visibleAgents.filter((agent) => !isAgentBuiltIn(agent));

  // Only agents SuplAgentics actually installed (see SUPLAGENTICS_AGENT_NAMES) — not every custom
  // agent, since a user's own hand-written one shouldn't get swept into this bulk toggle just for
  // living in the same directory. Deliberately NOT filtered by current disable state: GET
  // /api/agent doesn't return disabled agents at all (verified live), so once everything's
  // disabled this list would go empty and the button would vanish entirely — the operation
  // always targets the full fixed set regardless of which ones happen to currently be visible.
  const presentSuplagenticsAgents = agents.filter((agent) => (SUPLAGENTICS_AGENT_NAMES as readonly string[]).includes(agent.name));
  const suplagenticsAgentsAllDisabled = presentSuplagenticsAgents.length === 0;

  // GET /api/agent doesn't return disabled agents at all (verified live — a disabled agent is
  // absent from the list entirely, not present-with-a-flag), so "not found" means something
  // different depending on direction: for disable, not-found means it worked; for enable,
  // not-found means it's still disabled and the toggle hasn't taken yet.
  const isAgentStateWrong = (current: Agent[], name: string, disable: boolean): boolean => {
    const agent = current.find((a) => a.name === name);
    if (disable) {
      return agent ? (agent as Agent & { disable?: boolean }).disable !== true : false;
    }
    return !agent || (agent as Agent & { disable?: boolean }).disable === true;
  };

  const patchAgentDisabled = async (name: string, disable: boolean): Promise<boolean> => {
    try {
      const res = await runtimeFetch(`/api/config/agents/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disable }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // A raw config-reload + refetch, not the store's own reloadOpenCodeConfiguration — that one
  // defaults to refreshing providers/commands/skills across every tracked project (mode:
  // 'projects'), not just the agent list this actually needs, and its own health-check wait has
  // a real (if bounded) 20s timeout. Verified live: writing 22 agent files back-to-back with no
  // pacing left a handful silently not persisted even though each individual PATCH reported
  // success — a real race, not just a UI display issue — so this also verifies the end state and
  // retries anything that didn't actually take, instead of trusting the write blindly.
  const runBulkToggle = async (targetNames: string[], disable: boolean) => {
    const total = targetNames.length;
    for (let i = 0; i < targetNames.length; i++) {
      setBulkToggleProgress({ current: i + 1, total, phase: t('settings.agents.sidebar.action.togglingPhaseWriting', { name: targetNames[i] }) });
      await patchAgentDisabled(targetNames[i], disable);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    setBulkToggleProgress({ current: total, total, phase: t('settings.agents.sidebar.action.togglingPhaseReloading') });
    await runtimeFetch('/api/config/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await loadAgents();

    // Verify — retry anything that didn't actually land.
    let current = useAgentsStore.getState().agents;
    const stillWrong = targetNames.filter((name) => isAgentStateWrong(current, name, disable));

    if (stillWrong.length > 0) {
      for (let i = 0; i < stillWrong.length; i++) {
        setBulkToggleProgress({ current: i + 1, total: stillWrong.length, phase: t('settings.agents.sidebar.action.togglingPhaseRetrying', { name: stillWrong[i] }) });
        await patchAgentDisabled(stillWrong[i], disable);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      setBulkToggleProgress({ current: stillWrong.length, total: stillWrong.length, phase: t('settings.agents.sidebar.action.togglingPhaseReloading') });
      await runtimeFetch('/api/config/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      await loadAgents();
      current = useAgentsStore.getState().agents;
    }

    return targetNames.filter((name) => isAgentStateWrong(current, name, disable));
  };

  const handleBulkToggleAgents = async () => {
    if (!bulkToggleAction || isBulkToggling) return;
    setIsBulkToggling(true);
    const disable = bulkToggleAction === 'disable';
    const targetNames: string[] = [...SUPLAGENTICS_AGENT_NAMES];

    // A genuine safety net only, not a normal ceiling — 22 real sequential PATCH requests (plus a
    // possible full retry pass) legitimately took longer than the first version of this
    // timeout (15s) allowed, cutting the operation off with an error while it was still honestly
    // working. The live progress bar below is what actually answers "is this stuck or working,"
    // so this can stay generous — it exists only to guarantee the dialog eventually closes if
    // something genuinely wedges, not to rush a real multi-agent write.
    const timeoutPromise = new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), 120_000));

    try {
      const result = await Promise.race([runBulkToggle(targetNames, disable), timeoutPromise]);
      if (result === 'timeout') {
        toast.error(t('settings.agents.sidebar.toast.suplagenticsBulkToggleTimedOut'));
      } else if (result.length > 0) {
        toast.error(`${result.length} agent(s) didn't update: ${result.join(', ')}`);
      } else {
        toast.success(disable ? t('settings.agents.sidebar.toast.suplagenticsDisabled') : t('settings.agents.sidebar.toast.suplagenticsEnabled'));
      }
    } catch {
      toast.error(t('settings.agents.sidebar.toast.suplagenticsBulkToggleFailed'));
    } finally {
      setIsBulkToggling(false);
      setBulkToggleAction(null);
      setBulkToggleProgress(null);
    }
  };

  // Group custom agents by subfolder
  const { groupedCustomAgents, ungroupedCustomAgents } = useMemo(() => {
    const groups: Record<string, typeof customAgents> = {};
    const ungrouped: typeof customAgents = [];
    for (const agent of customAgents) {
      const ext = agent as { group?: string };
      if (ext.group) {
        if (!groups[ext.group]) groups[ext.group] = [];
        groups[ext.group].push(agent);
      } else {
        ungrouped.push(agent);
      }
    }
    const sortedGroups = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, agents: groups[name] }));
    return { groupedCustomAgents: sortedGroups, ungroupedCustomAgents: ungrouped };
  }, [customAgents]);

  return (
    <div className={cn('flex h-full flex-col', bgClass)}>
      <div className="border-b px-3 pt-4 pb-3">
        <h2 className="text-base font-semibold text-foreground mb-3">{t('settings.agents.sidebar.title')}</h2>
        <SettingsProjectSelector className="mb-3" />
        <div className="flex items-center justify-between gap-2">
          <span className="typography-meta text-muted-foreground">{t('settings.agents.sidebar.total', { count: visibleAgents.length })}</span>
          <Button size="sm"
            data-settings-item="agents.create"
            variant="ghost"
            className="h-7 w-7 px-0 -my-1 text-muted-foreground"
            onClick={handleCreateNew}
          >
            <Icon name="add" className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full justify-center text-xs"
          onClick={() => setBulkToggleAction(suplagenticsAgentsAllDisabled ? 'enable' : 'disable')}
        >
          {suplagenticsAgentsAllDisabled
            ? t('settings.agents.sidebar.action.enableSuplagentics')
            : t('settings.agents.sidebar.action.disableSuplagentics')}
        </Button>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="space-y-1 px-3 py-2 overflow-x-hidden">
        {visibleAgents.length === 0 ? (
          <div className="py-12 px-4 text-center text-muted-foreground">
            <Icon name="robot-2" className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="typography-ui-label font-medium">{t('settings.agents.sidebar.empty.title')}</p>
            <p className="typography-meta mt-1 opacity-75">{t('settings.agents.sidebar.empty.description')}</p>
          </div>
        ) : (
          <>
            {builtInAgents.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('settings.agents.sidebar.section.builtIn')}
                </div>
                {builtInAgents.map((agent) => (
                  <AgentListItem
                    key={agent.name}
                    agent={agent}
                    isSelected={selectedAgentName === agent.name}
                    onSelect={() => {
                      setSelectedAgent(agent.name);
                      onItemSelect?.();

                    }}
                    onReset={() => handleResetAgent(agent)}
                    onDuplicate={() => handleDuplicateAgent(agent)}
                    getAgentModeIcon={getAgentModeIcon}
                    isMenuOpen={openMenuAgent === agent.name}
                    onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                  />
                ))}
              </>
            )}

            {customAgents.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('settings.agents.sidebar.section.custom')}
                </div>

                {/* Grouped agents by subfolder */}
                {groupedCustomAgents.map(({ name: groupName, agents: groupAgents }) => (
                  <SidebarGroup
                    key={groupName}
                    label={groupName}
                    count={groupAgents.length}
                    storageKey="agents"
                  >
                    {groupAgents.map((agent) => (
                      <AgentListItem
                        key={agent.name}
                        agent={agent}
                        isSelected={selectedAgentName === agent.name}
                        onSelect={() => {
                          setSelectedAgent(agent.name);
                          onItemSelect?.();

                        }}
                        onRename={() => handleOpenRenameDialog(agent)}
                        onDelete={() => handleDeleteAgent(agent)}
                        onDuplicate={() => handleDuplicateAgent(agent)}
                        getAgentModeIcon={getAgentModeIcon}
                        isMenuOpen={openMenuAgent === agent.name}
                        onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                      />
                    ))}
                  </SidebarGroup>
                ))}

                {/* Ungrouped agents (flat in root agents dir) */}
                {ungroupedCustomAgents.map((agent) => (
                  <AgentListItem
                    key={agent.name}
                    agent={agent}
                    isSelected={selectedAgentName === agent.name}
                    onSelect={() => {
                      setSelectedAgent(agent.name);
                      onItemSelect?.();

                    }}
                    onRename={() => handleOpenRenameDialog(agent)}
                    onDelete={() => handleDeleteAgent(agent)}
                    onDuplicate={() => handleDuplicateAgent(agent)}
                    getAgentModeIcon={getAgentModeIcon}
                    isMenuOpen={openMenuAgent === agent.name}
                    onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollableOverlay>

      <Dialog
        open={confirmActionAgent !== null && confirmActionType !== null}
        onOpenChange={(open) => {
          if (!open && !isConfirmActionPending) {
            closeConfirmActionDialog();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmActionType === 'delete' ? t('settings.agents.sidebar.dialog.deleteTitle') : t('settings.agents.sidebar.dialog.resetTitle')}</DialogTitle>
            <DialogDescription>
              {confirmActionType === 'delete'
                ? t('settings.agents.sidebar.dialog.deleteDescription', { name: confirmActionAgent?.name ?? '' })
                : t('settings.agents.sidebar.dialog.resetDescription', { name: confirmActionAgent?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={closeConfirmActionDialog}
              disabled={isConfirmActionPending}
            >
              {t('settings.common.actions.cancel')}
            </Button>
            <Button size="sm" onClick={handleConfirmAction} disabled={isConfirmActionPending}>
              {confirmActionType === 'delete' ? t('settings.common.actions.delete') : t('settings.common.actions.reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkToggleAction !== null}
        onOpenChange={(open) => { if (!open && !isBulkToggling) setBulkToggleAction(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkToggleAction === 'disable'
                ? t('settings.agents.sidebar.dialog.disableSuplagenticsTitle')
                : t('settings.agents.sidebar.dialog.enableSuplagenticsTitle')}
            </DialogTitle>
            <DialogDescription>
              {bulkToggleAction === 'disable'
                ? t('settings.agents.sidebar.dialog.disableSuplagenticsDescription', { count: SUPLAGENTICS_AGENT_NAMES.length })
                : t('settings.agents.sidebar.dialog.enableSuplagenticsDescription', { count: SUPLAGENTICS_AGENT_NAMES.length })}
            </DialogDescription>
          </DialogHeader>
          {isBulkToggling && bulkToggleProgress && (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((bulkToggleProgress.current / Math.max(1, bulkToggleProgress.total)) * 100)}%` }}
                />
              </div>
              <p className="typography-meta text-muted-foreground">
                {bulkToggleProgress.phase} ({bulkToggleProgress.current}/{bulkToggleProgress.total})
              </p>
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setBulkToggleAction(null)} disabled={isBulkToggling}>
              {t('settings.common.actions.cancel')}
            </Button>
            <Button size="sm" onClick={handleBulkToggleAgents} disabled={isBulkToggling}>
              {isBulkToggling
                ? t('settings.agents.sidebar.action.toggling')
                : bulkToggleAction === 'disable' ? t('settings.common.actions.disable') : t('settings.common.actions.enable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogAgent !== null} onOpenChange={(open) => !open && setRenameDialogAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.agents.sidebar.renameDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.agents.sidebar.renameDialog.description', { name: renameDialogAgent?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            placeholder={t('settings.agents.sidebar.renameDialog.placeholder')}
            className="text-foreground placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRenameAgent();
              }
            }}
          />
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRenameDialogAgent(null)}
            >
              {t('settings.common.actions.cancel')}
            </Button>
            <Button size="sm" onClick={handleRenameAgent}>
              {t('settings.common.actions.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface AgentListItemProps {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  onRename?: () => void;
  onDuplicate: () => void;
  getAgentModeIcon: (mode?: string) => React.ReactNode;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

const AgentListItem: React.FC<AgentListItemProps> = ({
  agent,
  isSelected,
  onSelect,
  onDelete,
  onReset,
  onRename,
  onDuplicate,
  getAgentModeIcon,
  isMenuOpen,
  onMenuOpenChange,
}) => {
  const { t } = useI18n();
  const extAgent = agent as Agent & { scope?: AgentScope };
  const isMobile = isMobileDeviceViaCSS();
  const [isContextMenuOpen, setIsContextMenuOpen] = React.useState(false);
  const renderMenuItems = (Item: React.ElementType) => (
    <>
      <Item onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect(); }}>
        <Icon name="edit" className="h-4 w-4 mr-px" />
        {t('settings.common.actions.edit')}
      </Item>
      {onRename && (
        <Item onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRename(); }}>
          <Icon name="edit" className="h-4 w-4 mr-px" />
          {t('settings.common.actions.rename')}
        </Item>
      )}
      <Item onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDuplicate(); }}>
        <Icon name="file-copy" className="h-4 w-4 mr-px" />
        {t('settings.common.actions.duplicate')}
      </Item>
      {onReset && (
        <Item onClick={(e: React.MouseEvent) => { e.stopPropagation(); onReset(); }}>
          <Icon name="restart" className="h-4 w-4 mr-px" />
          {t('settings.common.actions.reset')}
        </Item>
      )}
      {onDelete && (
        <Item onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(); }} className="text-destructive focus:text-destructive">
          <Icon name="delete-bin" className="h-4 w-4 mr-px" />
          {t('settings.common.actions.delete')}
        </Item>
      )}
    </>
  );
  
  return (
    <ContextMenu open={isContextMenuOpen} onOpenChange={setIsContextMenuOpen}>
      <ContextMenuTrigger render={<div className={cn('group relative flex items-center rounded-md px-1.5 py-1 transition-all duration-200 select-none', isSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover')} onContextMenu={!isMobile ? (e) => { e.preventDefault(); setIsContextMenuOpen(true); } : undefined} />}>
      <div className="flex min-w-0 flex-1 items-center">
        <button
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          tabIndex={0}
        >
          <div className="flex items-center gap-1.5">
            <span className="typography-ui-label font-normal truncate text-foreground">
              {agent.name}
            </span>
            {getAgentModeIcon(agent.mode)}
            {(extAgent.scope || isAgentBuiltIn(agent)) && (
              <span className="typography-micro text-muted-foreground bg-muted px-1 rounded flex-shrink-0 leading-none pb-px border border-border/50">
                {isAgentBuiltIn(agent) ? t('settings.agents.sidebar.badge.system') : extAgent.scope}
              </span>
            )}
          </div>

          {agent.description && (
            <div className="typography-micro text-muted-foreground/60 truncate leading-tight">
              {agent.description}
            </div>
          )}
        </button>

        <DropdownMenu open={isMenuOpen} onOpenChange={(open) => { if (open) setIsContextMenuOpen(false); onMenuOpenChange(open); }}>
          <DropdownMenuTrigger asChild>
            <Button size="sm"
              variant="ghost"
              className="h-6 w-6 px-0 flex-shrink-0 -mr-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <Icon name="more-2" className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-fit min-w-20">
            {renderMenuItems(DropdownMenuItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-fit min-w-20">
        {renderMenuItems(ContextMenuItem)}
      </ContextMenuContent>
    </ContextMenu>
  );
};
