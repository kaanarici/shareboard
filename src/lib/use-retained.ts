import { useState } from "react";

export function useRetained<T>(value: T, present: boolean): T {
  const [retained, setRetained] = useState(value);
  if (present && !Object.is(value, retained)) setRetained(value);
  return present ? value : retained;
}
