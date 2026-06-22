"use client";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui";
import { ExternalLink } from "lucide-react";

// Generic gated-iframe panel for embedded localhost services (ttyd, filebrowser).
// The src is a same-origin path proxied behind the gate — nothing is public.
export function EmbedPanel({
  title,
  icon,
  src,
  onExpand,
  expanded = false,
}: {
  title: string;
  icon: React.ReactNode;
  src: string;
  onExpand?: () => void;
  expanded?: boolean;
}) {
  return (
    <Panel
      title={title}
      icon={icon}
      onExpand={onExpand}
      bodyClassName="p-0"
      right={
        !expanded ? (
          <a href={src} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink size={12} /> open
            </Button>
          </a>
        ) : undefined
      }
    >
      <iframe
        src={src}
        title={title}
        className="w-full border-0 bg-base"
        style={{ height: expanded ? "78vh" : 240 }}
      />
    </Panel>
  );
}
