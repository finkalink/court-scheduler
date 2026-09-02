import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillLevelPicker from "./SkillLevelPicker";

describe("SkillLevelPicker", () => {
  it("shows a hint for the saved value when switching to plain-language view with a letter-only rating", async () => {
    const user = userEvent.setup();
    render(<SkillLevelPicker defaultValue="AA" />);

    await user.click(screen.getByLabelText(/not familiar with volleyball skill ratings/i));

    expect(screen.getByText(/currently saved: AA/i)).toBeInTheDocument();
  });

  it("does not show the hint when the saved value has a plain-language equivalent", async () => {
    const user = userEvent.setup();
    render(<SkillLevelPicker defaultValue="B" />);

    await user.click(screen.getByLabelText(/not familiar with volleyball skill ratings/i));

    expect(screen.queryByText(/currently saved/i)).not.toBeInTheDocument();
  });

  it("does not show the hint when nothing is saved yet", async () => {
    const user = userEvent.setup();
    render(<SkillLevelPicker defaultValue={null} />);

    await user.click(screen.getByLabelText(/not familiar with volleyball skill ratings/i));

    expect(screen.queryByText(/currently saved/i)).not.toBeInTheDocument();
  });
});
