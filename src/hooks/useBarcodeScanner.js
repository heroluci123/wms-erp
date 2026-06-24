import { useRef, useCallback } from 'react'

/**
 * Hook para lidar com scanners de código de barras via teclado
 * Scanners enviam os caracteres + Enter ao final
 * O hook detecta o Enter e dispara o callback onScan
 *
 * @param {Function} onScan - Callback chamado com o valor final ao pressionar Enter
 * @param {Function} onTab  - (opcional) Callback para Tab (avançar campo)
 */
export function useBarcodeScanner({ onScan, onTab } = {}) {
  const inputRef = useRef(null)

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = e.target.value.trim()
      if (value && onScan) {
        onScan(value)
      }
    }
    if (e.key === 'Tab' && onTab) {
      e.preventDefault()
      onTab()
    }
  }, [onScan, onTab])

  const focus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const clear = useCallback(() => {
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  return { inputRef, handleKeyDown, focus, clear }
}
