variable "publish_revision" {
  description = "Publish the staged configuration. Any change to this value publishes again (for example a hash of your Kong resources); null publishes nothing."
  type        = string
  default     = null
}

variable "rollback_to" {
  description = "Roll the live configuration back to this published version; null leaves it alone."
  type        = number
  default     = null
}
