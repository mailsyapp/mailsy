export function blockImplicitSubmit(event: React.KeyboardEvent<HTMLFormElement>): void {
  if (
    event.key === 'Enter' &&
    event.target instanceof HTMLInputElement &&
    !event.nativeEvent.isComposing
  ) {
    event.preventDefault()
  }
}
