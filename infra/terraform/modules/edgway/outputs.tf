output "published_version" {
  description = "The version the last publish created, if any."
  value       = one(restapi_object.publish[*].id)
}
