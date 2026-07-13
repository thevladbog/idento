import * as ui from "./index";

describe("@idento/ui public API", () => {
  it.each([
    "cn",
    "Button", "buttonVariants", "Label", "Input",
    "Card", "CardHeader", "CardTitle", "CardDescription", "CardContent", "CardFooter",
    "Dialog", "DialogTrigger", "DialogContent", "DialogHeader", "DialogFooter",
    "DialogTitle", "DialogDescription", "DialogClose",
    "Sheet", "SheetTrigger", "SheetContent", "SheetHeader", "SheetTitle", "SheetClose",
    "DropdownMenu", "DropdownMenuTrigger", "DropdownMenuContent", "DropdownMenuItem",
    "DropdownMenuLabel", "DropdownMenuSeparator",
    "TooltipProvider", "Tooltip", "TooltipTrigger", "TooltipContent",
    "Separator", "Switch", "Avatar", "AvatarImage", "AvatarFallback",
    "StatusPill", "STATUS_PILL_STATUSES",
    "Skeleton", "EmptyState",
    "ConfirmDialog",
    "AgentStatus", "AGENT_STATES",
    "VERDICTS", "verdictClasses",
  ])("exports %s", (name) => {
    expect(ui).toHaveProperty(name);
  });
});
