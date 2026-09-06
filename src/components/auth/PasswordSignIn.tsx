// The canonical password sign-in component is PasswordSignInForm.tsx
// (DEC-0295 rule 4, OWM-T0035). This file briefly held a duplicate
// implementation and is kept as a re-export, not deleted, because this
// seat's GitHub grant carries no file-delete tool.
export {
  PasswordSignInForm as PasswordSignIn,
  type PasswordSignInFormProps as PasswordSignInProps,
} from "./PasswordSignInForm";
