import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@edgway/ui-kit/components/admin/form";
import { InputHelperText } from "@edgway/ui-kit/components/admin/input-helper-text";
import { Input } from "@edgway/ui-kit/components/ui/input";
import { Textarea } from "@edgway/ui-kit/components/ui/textarea";
import type { InputProps } from "ra-core";
import { FieldTitle, useInput, useResourceContext } from "ra-core";

export type TextInputProps = InputProps & {
  multiline?: boolean;
  inputClassName?: string;
} & React.ComponentProps<"textarea"> &
  React.ComponentProps<"input">;

/**
 * Single-line or multiline text input for string values.
 *
 * Use `<TextInput>` for short text fields like titles or names. Set `multiline` to `true`
 * for longer content like descriptions or comments. Wraps shadcn's `<Input>` or `<Textarea>`
 * component depending on the `multiline` prop.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/textinput/ TextInput documentation}
 *
 * @example
 * import { Edit, SimpleForm, TextInput } from '@/components/admin';
 *
 * const PostEdit = () => (
 *   <Edit>
 *     <SimpleForm>
 *       <TextInput source="title" />
 *       <TextInput source="description" multiline rows={4} />
 *     </SimpleForm>
 *   </Edit>
 * );
 */
export const TextInput = (props: TextInputProps) => {
  const resource = useResourceContext(props);
  const {
    label,
    source,
    multiline,
    className,
    inputClassName,
    helperText,
    validate: _validateProp,
    format: _formatProp,
    ...rest
  } = props;
  const { id, field, isRequired } = useInput(props);

  return (
    <FormField id={id} className={className} name={field.name}>
      {label !== false && (
        <FormLabel>
          <FieldTitle
            label={label}
            source={source}
            resource={resource}
            isRequired={isRequired}
          />
        </FormLabel>
      )}
      <FormControl>
        {multiline ? (
          <Textarea {...rest} {...field} className={inputClassName} />
        ) : (
          <Input {...rest} {...field} className={inputClassName} />
        )}
      </FormControl>
      <InputHelperText helperText={helperText} />
      <FormError />
    </FormField>
  );
};
