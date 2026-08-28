export interface SlotOverrideFormInput {
  date: string;
  isClosed: boolean;
  customOpen: string;
  customClose: string;
}

export interface SlotOverrideValue {
  date: string;
  is_closed: boolean;
  custom_open: string | null;
  custom_close: string | null;
}

export type SlotOverrideValidationResult =
  | { valid: true; value: SlotOverrideValue }
  | { valid: false; error: string };

export function validateSlotOverride(input: SlotOverrideFormInput): SlotOverrideValidationResult {
  if (!input.date) {
    return { valid: false, error: "Pick a date." };
  }

  if (input.isClosed) {
    return {
      valid: true,
      value: { date: input.date, is_closed: true, custom_open: null, custom_close: null },
    };
  }

  if (!input.customOpen || !input.customClose) {
    return {
      valid: false,
      error: "Provide both a custom open and close time, or mark the day closed.",
    };
  }

  if (input.customOpen >= input.customClose) {
    return { valid: false, error: "Custom open time must be before the close time." };
  }

  return {
    valid: true,
    value: {
      date: input.date,
      is_closed: false,
      custom_open: input.customOpen,
      custom_close: input.customClose,
    },
  };
}
