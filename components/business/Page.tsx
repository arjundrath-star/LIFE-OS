import Link from "next/link";

export function BusinessPage({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const serviceBack = title.startsWith("Service ·") ? <Link className="business-primary-action mb-4" href="/business/locations">← Back to locations</Link> : null;
  return <div className="business-page"><div className="business-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions}</div>{serviceBack}{children}</div>;
}

export function BusinessSection({ title, note, children, className = "" }: { title: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`business-section ${className}`}><header><h2>{title}</h2>{note && <div>{note}</div>}</header><div className="business-section-body">{children}</div></section>;
}

export function Fact({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return <div className="business-fact"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function SourceStamp({ children }: { children: React.ReactNode }) {
  return <span className="business-source">{children}</span>;
}
