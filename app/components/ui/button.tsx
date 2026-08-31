import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // DESIGN.md: primary CTA is near-black, 12px (rounded.lg), 500 weight.
  // Secondary is white with hairline outline. No hover states documented —
  // only Default and Active (press darkens primary to #0d1218).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground active:bg-primary-active",
        destructive: "bg-destructive text-destructive-foreground active:bg-destructive/90",
        outline: "border border-hairline bg-canvas text-ink hover:bg-surface-soft active:border-strong",
        secondary: "bg-secondary text-secondary-foreground active:bg-secondary/80",
        ghost: "text-ink hover:bg-surface-soft",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-2 rounded-lg", // DESIGN.md button: 16px padding vertical
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-8",
        icon: "h-10 w-10 rounded-full", // DESIGN.md button-icon-circular 40px
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
