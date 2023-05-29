import express from 'express'
import { check, validationResult } from 'express-validator'
import { logger } from './logger'

export const validateFileName =
  check('0').isString().withMessage('File name should be a string')

export const validateFunctionName =
  check('functionName').isString().withMessage('Function name should be a string')

// Parameter validation function
export const validateParams: express.RequestHandler = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty())
    return next({
      error: new Error('Validation failed'),
      validationErrors: errors.array()
    })

  return
}

export const handleErrors: express.ErrorRequestHandler = (err, req, res, next) => {
  logger.error(err)
  if (err.code === 'ENOENT')
    return res.status(404).send({ error: 'File not found' })
  if (err.code === 'EACCES')
    return res.status(403).send({ error: 'Permission denied' })
  if (err.code === 'ETIMEDOUT')
    return res.status(500).send({ error: `Response timed out after ${err.timeout}ms`})
  if ('error' in err && 'validationErrors' in err)
    return res.status(400).json({ error: err.error.message, details: err.validationErrors })
  res.status(500).json({ error: 'Internal server error' })
}
