import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PlaceholderPage({
  title,
  promptNumber,
  blurb,
}: {
  title: string;
  promptNumber: string;
  blurb?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {blurb && <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>}
      </div>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">
            Coming in prompt {promptNumber}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            This section will be built next.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
