// Provider-agnostic building blocks shared by the AI subsystems.
//
// Nothing in here may import from `../chat` or `../image`: the dependency
// direction is always chat → shared and image → shared, never the reverse.

export {
  createStructuredLogger,
  redact,
  type LogLevel,
  type StructuredLogger,
} from "./structured-logger";
