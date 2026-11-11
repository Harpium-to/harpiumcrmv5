'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Option {
  value: string;
  label: string;
  /** A colour dot before the label — which agenda this is. */
  color?: string;
}

/**
 * The agenda's dropdowns are all "one of these labelled values", so
 * they share this instead of each restating the Select plumbing.
 */
export function OptionSelect({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const byValue = new Map(options.map((o) => [o.value, o]));
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string' && byValue.has(next)) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        disabled={disabled}
        // `min-w-0` all the way down: a long label must shorten itself
        // inside a narrow grid cell, not push the dialog wider.
        className={cn(
          'border-border bg-muted text-foreground w-full min-w-0 *:data-[slot=select-value]:min-w-0',
          className,
        )}
      >
        <SelectValue>
          {(current: string) => {
            const option = byValue.get(current);
            return (
              <>
                {option?.color ? <Dot color={option.color} /> : null}
                <span className="truncate">{option?.label ?? current}</span>
              </>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.color ? <Dot color={option.color} /> : null}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}
